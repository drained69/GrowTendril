import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { enqueue } from "@/server/jobs/queue";
import { publicUrl, getPublicText } from "@/server/security/public-http";
import { encryptJson, decryptJson } from "@/server/security/secrets";
import { signWebhook } from "@/server/security/hmac";

export const WEBHOOK_EVENTS = [
  { key: "approval.requested", label: "Approval requested" },
  { key: "payment.settled", label: "Payment settled" },
  { key: "payment.failed", label: "Payment failed" },
  { key: "cycle.finished", label: "Cycle finished" },
  { key: "creator.post_submitted", label: "Creator post submitted" },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"] | "webhook.test";
export type WebhookFormat = "json" | "slack" | "discord";
export const MAX_ENDPOINTS = 10;
const AAD = "growtendril:webhook";

export function validateEndpointUrl(raw: string, format: WebhookFormat): string {
  let url: URL;
  try { url = publicUrl(raw.trim()); } catch { throw new Error("Use a public HTTPS URL. Private and local addresses are blocked."); }
  if (url.protocol !== "https:") throw new Error("Notification endpoints must use HTTPS.");
  if (format === "slack" && (url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/"))) throw new Error("Use a Slack incoming webhook URL from hooks.slack.com/services/.");
  if (format === "discord" && (!["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"].includes(url.hostname) || !url.pathname.startsWith("/api/webhooks/"))) throw new Error("Use a Discord webhook URL from discord.com/api/webhooks/.");
  return url.toString();
}

export const newSigningSecret = () => `whsec_${randomBytes(32).toString("hex")}`;
export const maskUrl = (url: string) => `${new URL(url).host}/…`;
export const seal = (url: string, secret: string) => encryptJson({ url, secret }, AAD);
const unseal = (value: string) => decryptJson(value, AAD);
const eventId = (projectId: string, key: string) => `evt_${createHash("sha256").update(`${projectId}:${key}`).digest("hex").slice(0, 24)}`;

export interface Envelope {
  id: string;
  type: WebhookEvent;
  created_at: string;
  workspace: { id: string; name: string };
  summary: string;
  url: string | null;
  data: Record<string, unknown>;
}
export const slackEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function formatBody(format: WebhookFormat, env: Envelope): string {
  if (format === "slack") return JSON.stringify({ text: `*${slackEscape(env.workspace.name)}* · ${slackEscape(env.summary)}${env.url ? ` <${env.url}|Open in GrowTendril>` : ""}` });
  if (format === "discord") return JSON.stringify({ content: `**${env.workspace.name}** · ${env.summary}${env.url ? `\n${env.url}` : ""}`.slice(0, 1900), allowed_mentions: { parse: [] } });
  return JSON.stringify(env);
}

export interface NotifyInput { event: WebhookEvent; key: string; summary: string; path?: string; data?: Record<string, unknown> }
/** Notification failures never interrupt the business action that emitted them. */
export async function notify(db: DB, projectId: string, input: NotifyInput): Promise<number> {
  try {
    const endpoints = await db.select().from(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.projectId, projectId), eq(s.webhookEndpoints.enabled, true)));
    const targets = endpoints.filter((endpoint) => endpoint.events.includes(input.event));
    if (!targets.length) return 0;
    const [project] = await db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId));
    const origin = process.env.APP_URL?.trim().replace(/\/$/, "");
    const env: Envelope = { id: eventId(projectId, input.key), type: input.event, created_at: new Date().toISOString(), workspace: { id: projectId, name: project?.name ?? "" }, summary: input.summary, url: origin && input.path?.startsWith("/") ? `${origin}${input.path}` : null, data: input.data ?? {} };
    let queued = 0;
    for (const endpoint of targets) {
      const didQueue = await db.transaction(async (tx) => {
        const [delivery] = await tx.insert(s.webhookDeliveries).values({ id: newId(), endpointId: endpoint.id, projectId, event: input.event, eventKey: input.key, payload: env as unknown as Record<string, unknown> })
          .onConflictDoNothing({ target: [s.webhookDeliveries.endpointId, s.webhookDeliveries.eventKey] }).returning({ id: s.webhookDeliveries.id });
        if (!delivery) return false;
        await enqueue(tx as unknown as DB, { kind: "webhook", projectId, payload: { deliveryId: delivery.id }, dedupeKey: `webhook:${delivery.id}`, maxAttempts: 6 });
        return true;
      });
      if (didQueue) queued++;
    }
    if (queued) void import("@/server/jobs/worker").then((worker) => worker.kickWorker()).catch(() => {});
    return queued;
  } catch {
    console.error("[GrowTendril notifications] could not queue an event");
    return 0;
  }
}

export async function deliver(db: DB, deliveryId: string, finalAttempt: boolean, send: typeof getPublicText = getPublicText) {
  const [delivery] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, deliveryId));
  if (!delivery || delivery.status !== "pending") return { skipped: true };
  const [endpoint] = await db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id, delivery.endpointId));
  if (!endpoint || !endpoint.enabled) {
    await db.update(s.webhookDeliveries).set({ status: "failed", error: "endpoint disabled", updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, deliveryId));
    return { skipped: true };
  }
  const env = delivery.payload as unknown as Envelope;
  const body = formatBody(endpoint.format as WebhookFormat, env);
  let status: number | null = null;
  try {
    const { url, secret } = unseal(endpoint.sealed);
    validateEndpointUrl(url, endpoint.format as WebhookFormat);
    const result = await send(url, { method: "POST", body, redirect: "error", timeoutMs: 10_000, maxBytes: 4096, headers: {
      "Content-Type": "application/json", "x-growtendril-event": env.type,
      "x-growtendril-delivery": delivery.id, "x-growtendril-event-id": env.id,
      "x-growtendril-signature": signWebhook(secret, body),
    } });
    status = result.status;
    if (!result.ok) throw new Error("HTTP failure");
    await db.update(s.webhookDeliveries).set({ status: "delivered", attempts: delivery.attempts + 1, responseStatus: status, error: null, updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, delivery.id));
    await db.update(s.webhookEndpoints).set({ lastStatus: `HTTP ${status}`, updatedAt: new Date() }).where(eq(s.webhookEndpoints.id, endpoint.id));
    return { delivered: true, status };
  } catch {
    const error = status ? `HTTP ${status}` : "Endpoint unreachable or blocked";
    await db.update(s.webhookDeliveries).set({ status: finalAttempt ? "failed" : "pending", attempts: delivery.attempts + 1, responseStatus: status, error, updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, delivery.id));
    if (finalAttempt) {
      await db.update(s.webhookEndpoints).set({ lastStatus: error, updatedAt: new Date() }).where(eq(s.webhookEndpoints.id, endpoint.id));
      return { delivered: false, status };
    }
    throw new Error(`Notification delivery failed: ${error}`);
  }
}

export async function listEndpoints(db: DB, projectId: string) {
  return db.select({ id: s.webhookEndpoints.id, urlHint: s.webhookEndpoints.urlHint, format: s.webhookEndpoints.format, events: s.webhookEndpoints.events, enabled: s.webhookEndpoints.enabled, lastStatus: s.webhookEndpoints.lastStatus })
    .from(s.webhookEndpoints).where(eq(s.webhookEndpoints.projectId, projectId)).orderBy(desc(s.webhookEndpoints.createdAt));
}
export async function recentDeliveries(db: DB, projectId: string) {
  return db.select({ id: s.webhookDeliveries.id, event: s.webhookDeliveries.event, status: s.webhookDeliveries.status, attempts: s.webhookDeliveries.attempts, responseStatus: s.webhookDeliveries.responseStatus, error: s.webhookDeliveries.error, createdAt: s.webhookDeliveries.createdAt })
    .from(s.webhookDeliveries).where(eq(s.webhookDeliveries.projectId, projectId)).orderBy(desc(s.webhookDeliveries.createdAt)).limit(20);
}
