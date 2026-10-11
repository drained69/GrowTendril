import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { enqueue } from "@/server/jobs/queue";
import { signWebhook } from "@/server/security/hmac";
import { checkUrl, safeFetch, UnsafeUrlError } from "@/server/security/safe-fetch";
import { decryptJson, encryptJson, secretHint } from "@/server/security/secrets";
import { USER_AGENT } from "@/server/integrations/providers/http";
import { IS_MAINNET } from "@/server/integrations/circle/config";

/**
 * Outbound notifications. A workspace registers endpoints (Slack, Discord or any HTTPS URL) and
 * picks events. Every delivery is signed (x-growtendril-signature, same scheme as inbound events),
 * sent through safeFetch (public addresses only, re-checked at connect time, no redirects), and
 * retried by the job queue with backoff. Notifying never blocks or fails the action that caused it.
 */

export const WEBHOOK_EVENTS = [
  { key: "approval.requested", label: "Approval needed", description: "A payment or reallocation is waiting for a person to approve it.", defaultOn: true },
  { key: "payment.settled", label: "Payment settled", description: "USDC moved: a creator payout, data purchase or deposit settled.", defaultOn: true },
  { key: "payment.failed", label: "Payment failed", description: "A payment could not be completed.", defaultOn: true },
  { key: "budget.threshold", label: "Budget threshold", description: "A mission has used 80% or 100% of its budget.", defaultOn: true },
  { key: "creator.applied", label: "Creator applied", description: "A creator applied to one of your campaigns.", defaultOn: false },
  { key: "creator.post_submitted", label: "Post submitted", description: "A creator submitted a post for review.", defaultOn: false },
  { key: "campaign.closed", label: "Campaign closed", description: "A creator campaign was closed, with its results.", defaultOn: true },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"] | "webhook.test";
export const EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.key) as string[];

export type WebhookFormat = "json" | "slack" | "discord";
export const MAX_ENDPOINTS = 10;
export const MAX_ATTEMPTS = 6;
/** Consecutive deliveries that exhausted every retry before the endpoint is switched off. */
export const DISABLE_AFTER = 5;

export class WebhookConfigError extends Error {}

/** Validates an endpoint URL for its format. HTTPS only, except plain http to a public host outside production. */
export function validateEndpointUrl(raw: string, format: WebhookFormat): string {
  let u: URL;
  try {
    u = checkUrl(raw.trim());
  } catch (e) {
    throw new WebhookConfigError(e instanceof UnsafeUrlError ? `That URL can't be used: ${e.message}` : "Enter a full URL (https://…)");
  }
  if (u.protocol !== "https:" && process.env.NODE_ENV === "production") throw new WebhookConfigError("Webhook URLs must use https://");
  if (format === "slack" && !(u.hostname === "hooks.slack.com" && u.pathname.startsWith("/services/"))) throw new WebhookConfigError("Slack URLs look like https://hooks.slack.com/services/… (Slack → Apps → Incoming Webhooks)");
  if (format === "discord" && !(/^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(u.hostname) && u.pathname.startsWith("/api/webhooks/"))) throw new WebhookConfigError("Discord URLs look like https://discord.com/api/webhooks/… (Channel settings → Integrations → Webhooks)");
  return u.toString();
}

export const newSigningSecret = () => `whsec_${randomBytes(32).toString("hex")}`;
const AAD = "growtendril:webhook";

/** "hooks.slack.com/…/a1f3" — recognisable, not usable. */
export function maskUrl(url: string): string {
  const u = new URL(url);
  const tail = u.pathname.replace(/\/$/, "").slice(-4);
  return `${u.host}${u.pathname.length > 1 ? `/…${tail}` : ""}`;
}

export const seal = (url: string, secret: string) => ({ sealed: encryptJson({ url, secret }, AAD), urlHint: maskUrl(url), secretHint: secretHint(secret) });
export const unseal = (sealed: string) => decryptJson(sealed, AAD) as { url: string; secret: string };

// ───────────────────────────── payloads ─────────────────────────────

export interface Envelope {
  id: string;
  type: WebhookEvent;
  created_at: string;
  network: "mainnet" | "testnet";
  workspace: { id: string; name: string };
  summary: string;
  url: string | null;
  data: Record<string, unknown>;
}

const appLink = (path: string | undefined) => {
  const base = process.env.APP_URL?.trim().replace(/\/$/, "");
  return base && path ? `${base}${path}` : null;
};

/** Slack mrkdwn treats <…> as links and mentions (<!channel>); escape anything user-supplied. */
export const slackEscape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatBody(format: WebhookFormat, env: Envelope): string {
  if (format === "slack") {
    const text = `*${slackEscape(env.workspace.name)}* · ${slackEscape(env.summary)}${env.url ? ` <${env.url}|Open in GrowTendril>` : ""}`;
    return JSON.stringify({ text });
  }
  if (format === "discord") {
    const content = `**${env.workspace.name}** · ${env.summary}${env.url ? `\n${env.url}` : ""}`.slice(0, 1900);
    // No @everyone / role / user pings, whatever a creator handle or title contains.
    return JSON.stringify({ content, allowed_mentions: { parse: [] } });
  }
  return JSON.stringify(env);
}

// ───────────────────────────── emit ─────────────────────────────

export interface NotifyInput {
  event: WebhookEvent;
  /** Unique per logical event (e.g. the approval id); an endpoint receives each key once. */
  key: string;
  summary: string;
  data: Record<string, unknown>;
  /** App path the notification links to, e.g. /app/approvals. */
  path?: string;
}

const eventId = (projectId: string, key: string) => `evt_${createHash("sha256").update(`${projectId}:${key}`).digest("hex").slice(0, 24)}`;

/** Queues the event for every enabled endpoint subscribed to it. Never throws. */
export async function notify(db: DB, projectId: string, n: NotifyInput): Promise<number> {
  try {
    const endpoints = await db.select().from(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.projectId, projectId), eq(s.webhookEndpoints.enabled, true)));
    const targets = endpoints.filter((e) => e.events.includes(n.event));
    if (!targets.length) return 0;
    const [project] = await db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId));
    const env: Envelope = { id: eventId(projectId, n.key), type: n.event, created_at: new Date().toISOString(), network: IS_MAINNET ? "mainnet" : "testnet", workspace: { id: projectId, name: project?.name ?? "" }, summary: n.summary, url: appLink(n.path), data: n.data };
    let queued = 0;
    for (const ep of targets) {
      const [d] = await db
        .insert(s.webhookDeliveries)
        .values({ id: newId(), endpointId: ep.id, projectId, event: n.event, eventKey: n.key, payload: env as unknown as Record<string, unknown> })
        .onConflictDoNothing({ target: [s.webhookDeliveries.endpointId, s.webhookDeliveries.eventKey] })
        .returning({ id: s.webhookDeliveries.id });
      if (!d) continue;
      await enqueue(db, { kind: "webhook", projectId, payload: { deliveryId: d.id }, dedupeKey: `webhook:${d.id}`, maxAttempts: MAX_ATTEMPTS });
      queued++;
    }
    if (queued) void import("@/server/jobs/worker").then((w) => w.kickWorker()).catch(() => {});
    return queued;
  } catch (e) {
    console.error("[growtendril webhooks] notify failed:", (e as Error).message);
    return 0;
  }
}

// ───────────────────────────── deliver ─────────────────────────────

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
}

/** One HTTP attempt. Only 2xx counts; redirects are not followed for POST. */
export async function sendOnce(ep: { format: string; sealed: string }, env: Envelope, deliveryId: string, fetcher: typeof safeFetch = safeFetch): Promise<DeliveryResult> {
  const body = formatBody(ep.format as WebhookFormat, env);
  const started = Date.now();
  try {
    const { url, secret } = unseal(ep.sealed);
    const r = await fetcher(url, {
      method: "POST",
      body,
      timeoutMs: 10_000,
      maxBytes: 4_096,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "x-growtendril-event": env.type,
        "x-growtendril-delivery": deliveryId,
        "x-growtendril-event-id": env.id,
        "x-growtendril-signature": signWebhook(secret, body),
      },
    });
    return { ok: r.ok, status: r.status, error: r.ok ? null : `HTTP ${r.status}${r.body ? `: ${r.body.slice(0, 160)}` : ""}`, durationMs: Date.now() - started };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message.slice(0, 300), durationMs: Date.now() - started };
  }
}

/**
 * Delivers one queued notification. Throws to ask the queue for a retry; on the final attempt it
 * records the failure instead, and repeated final failures switch the endpoint off.
 */
export async function deliver(db: DB, deliveryId: string, attempt: { final: boolean }, fetcher?: typeof safeFetch): Promise<DeliveryResult & { skipped?: string }> {
  const [d] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, deliveryId));
  if (!d) return { ok: false, status: null, error: null, durationMs: 0, skipped: "delivery deleted" };
  if (d.status === "delivered") return { ok: true, status: d.responseStatus, error: null, durationMs: 0, skipped: "already delivered" };
  const [ep] = await db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id, d.endpointId));
  if (!ep || !ep.enabled) {
    await db.update(s.webhookDeliveries).set({ status: "failed", error: "endpoint disabled", updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, d.id));
    return { ok: false, status: null, error: "endpoint disabled", durationMs: 0, skipped: "endpoint disabled" };
  }
  const r = await sendOnce(ep, d.payload as unknown as Envelope, d.id, fetcher);
  const now = new Date();
  const gone = r.status === 410;
  const final = attempt.final || gone;
  await db
    .update(s.webhookDeliveries)
    .set({ status: r.ok ? "delivered" : final ? "failed" : "pending", attempts: d.attempts + 1, responseStatus: r.status, error: r.error, durationMs: r.durationMs, deliveredAt: r.ok ? now : null, updatedAt: now })
    .where(eq(s.webhookDeliveries.id, d.id));
  if (r.ok) {
    await db.update(s.webhookEndpoints).set({ consecutiveFailures: 0, lastDeliveryAt: now, lastStatus: `HTTP ${r.status}`, updatedAt: now }).where(eq(s.webhookEndpoints.id, ep.id));
    return r;
  }
  if (final) {
    const failures = ep.consecutiveFailures + 1;
    const disable = gone ? "The endpoint answered 410 Gone" : failures >= DISABLE_AFTER ? `${failures} deliveries in a row failed after every retry` : null;
    await db
      .update(s.webhookEndpoints)
      .set({ consecutiveFailures: failures, lastDeliveryAt: now, lastStatus: r.error ?? "failed", ...(disable ? { enabled: false, disabledReason: disable } : {}), updatedAt: now })
      .where(eq(s.webhookEndpoints.id, ep.id));
    return r;
  }
  throw new Error(`webhook delivery failed: ${r.error}`);
}

/** Sends a test event straight away, so the founder sees the result in the UI. */
export async function sendTest(db: DB, projectId: string, endpointId: string, fetcher?: typeof safeFetch): Promise<DeliveryResult> {
  const [ep] = await db.select().from(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.id, endpointId), eq(s.webhookEndpoints.projectId, projectId)));
  if (!ep) throw new WebhookConfigError("Endpoint not found");
  const [project] = await db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId));
  const key = `webhook.test:${newId()}`;
  const env: Envelope = { id: eventId(projectId, key), type: "webhook.test", created_at: new Date().toISOString(), network: IS_MAINNET ? "mainnet" : "testnet", workspace: { id: projectId, name: project?.name ?? "" }, summary: "Test notification — this endpoint is connected.", url: appLink("/app/integrations"), data: { test: true } };
  const id = newId();
  await db.insert(s.webhookDeliveries).values({ id, endpointId: ep.id, projectId, event: "webhook.test", eventKey: key, payload: env as unknown as Record<string, unknown> });
  // A test never counts toward auto-disable, but it is recorded like any delivery.
  const r = await sendOnce(ep, env, id, fetcher);
  await db.update(s.webhookDeliveries).set({ status: r.ok ? "delivered" : "failed", attempts: 1, responseStatus: r.status, error: r.error, durationMs: r.durationMs, deliveredAt: r.ok ? new Date() : null, updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, id));
  await db.update(s.webhookEndpoints).set({ lastDeliveryAt: new Date(), lastStatus: r.ok ? `test OK (HTTP ${r.status})` : `test failed: ${r.error ?? "error"}`.slice(0, 200), updatedAt: new Date() }).where(eq(s.webhookEndpoints.id, ep.id));
  return r;
}

/** Re-queues a failed delivery (same event id, so receivers can de-duplicate). */
export async function redeliver(db: DB, projectId: string, deliveryId: string): Promise<void> {
  const [d] = await db.select().from(s.webhookDeliveries).where(and(eq(s.webhookDeliveries.id, deliveryId), eq(s.webhookDeliveries.projectId, projectId)));
  if (!d) throw new WebhookConfigError("Delivery not found");
  if (d.status !== "failed") throw new WebhookConfigError("Only failed deliveries can be resent");
  const [ep] = await db.select({ enabled: s.webhookEndpoints.enabled }).from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id, d.endpointId));
  if (!ep?.enabled) throw new WebhookConfigError("Turn the endpoint back on first");
  await db.update(s.webhookDeliveries).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(s.webhookDeliveries.id, d.id));
  await enqueue(db, { kind: "webhook", projectId, payload: { deliveryId: d.id }, dedupeKey: `webhook:${d.id}:${Date.now()}`, maxAttempts: MAX_ATTEMPTS });
}

export async function listEndpoints(db: DB, projectId: string) {
  return db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.projectId, projectId)).orderBy(s.webhookEndpoints.createdAt);
}

export async function recentDeliveries(db: DB, projectId: string, limit = 25) {
  return db
    .select({ id: s.webhookDeliveries.id, endpointId: s.webhookDeliveries.endpointId, event: s.webhookDeliveries.event, status: s.webhookDeliveries.status, attempts: s.webhookDeliveries.attempts, responseStatus: s.webhookDeliveries.responseStatus, error: s.webhookDeliveries.error, durationMs: s.webhookDeliveries.durationMs, createdAt: s.webhookDeliveries.createdAt })
    .from(s.webhookDeliveries)
    .where(eq(s.webhookDeliveries.projectId, projectId))
    .orderBy(desc(s.webhookDeliveries.createdAt))
    .limit(limit);
}

/** Old finished delivery rows are pruned by the cleanup job. */
export async function pruneDeliveries(db: DB, olderThan: Date): Promise<void> {
  await db.delete(s.webhookDeliveries).where(and(inArray(s.webhookDeliveries.status, ["delivered", "failed"]), lt(s.webhookDeliveries.createdAt, olderThan)));
}

// ───────────────────────────── event helpers ─────────────────────────────

const usd = (micro: number) => `${(micro / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`;

const TX_LABEL: Record<string, string> = { x402_purchase: "Data purchase", send: "Payout", bridge: "Bridge", gateway_deposit: "Gateway deposit" };

export function notifyApproval(db: DB, a: { projectId: string; approvalId: string; title: string; requestedMicro: number }) {
  return notify(db, a.projectId, {
    event: "approval.requested",
    key: `approval.requested:${a.approvalId}`,
    summary: `Approval needed: ${a.title} (${usd(a.requestedMicro)})`,
    data: { approval_id: a.approvalId, title: a.title, amount_usdc: a.requestedMicro / 1_000_000 },
    path: "/app/approvals",
  });
}

type TxRow = typeof s.transactions.$inferSelect;

export async function notifyTransaction(db: DB, tx: TxRow, to: string) {
  if (to === "SETTLED" || to === "FAILED") {
    const label = TX_LABEL[tx.kind] ?? "Payment";
    await notify(db, tx.projectId, {
      event: to === "SETTLED" ? "payment.settled" : "payment.failed",
      key: `payment.${to.toLowerCase()}:${tx.id}`,
      summary: to === "SETTLED" ? `${label} of ${usd(tx.amountMicro)} settled` : `${label} of ${usd(tx.amountMicro)} failed${tx.error ? `: ${tx.error.slice(0, 140)}` : ""}`,
      data: { transaction_id: tx.id, kind: tx.kind, amount_usdc: tx.amountMicro / 1_000_000, category: tx.budgetCategory, chain: tx.chain, recipient: tx.recipient, tx_hash: tx.txHash ?? tx.batchTxHash, explorer_url: tx.explorerUrl, data_mode: tx.dataMode, error: to === "FAILED" ? tx.error : null },
      path: "/app/receipts",
    });
  }
}

/** Called after spend is committed; emits once per mission when 80% and 100% of its budget are used. */
export async function notifyBudget(db: DB, a: { projectId: string; missionId: string; missionName: string; budgetMicro: number; spentMicro: number }) {
  if (a.budgetMicro <= 0) return;
  const pct = a.spentMicro / a.budgetMicro;
  for (const threshold of [1, 0.8]) {
    if (pct < threshold) continue;
    await notify(db, a.projectId, {
      event: "budget.threshold",
      key: `budget.threshold:${a.missionId}:${threshold * 100}`,
      summary: `${a.missionName} has used ${Math.floor(pct * 100)}% of its budget (${usd(a.spentMicro)} of ${usd(a.budgetMicro)})`,
      data: { mission_id: a.missionId, threshold_percent: threshold * 100, spent_usdc: a.spentMicro / 1_000_000, budget_usdc: a.budgetMicro / 1_000_000 },
      path: "/app/missions",
    });
    return;
  }
}
