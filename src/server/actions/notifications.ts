"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { EVENT_KEYS, MAX_ENDPOINTS, newSigningSecret, redeliver, seal, sendTest, unseal, validateEndpointUrl, type WebhookFormat } from "@/server/domain/notifications/webhooks";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

async function notificationsGuard() {
  const g = await guard("manage_integrations");
  if (g.user.isGuest) throw new Error("Guest accounts can't send notifications — create an account first.");
  if (g.project.dataMode === "DEMO") throw new Error("Demo workspaces don't send notifications. Set up your own workspace first.");
  return g;
}

const EndpointForm = z.object({
  url: z.string().trim().min(1, "Enter the URL to send notifications to").max(500),
  format: z.enum(["json", "slack", "discord"]),
  description: z.string().trim().max(120).optional(),
  events: z.array(z.string().refine((e) => EVENT_KEYS.includes(e), "Unknown event")).min(1, "Pick at least one event"),
});

const done = () => revalidatePath("/app/integrations");

/** Adds an endpoint. Its signing secret is returned once and stored encrypted. */
export async function createEndpointAction(_: unknown, form: FormData): Promise<ActionResult<{ secret: string; id: string }>> {
  try {
    const { project, db, user } = await notificationsGuard();
    await limited(`webhook-create:${user.id}`, 10, 0.05);
    const f = EndpointForm.parse({ url: form.get("url"), format: form.get("format"), description: String(form.get("description") ?? "").trim() || undefined, events: form.getAll("events").map(String) });
    const url = validateEndpointUrl(f.url, f.format as WebhookFormat);
    const [{ n }] = await db.select({ n: count() }).from(s.webhookEndpoints).where(eq(s.webhookEndpoints.projectId, project.id));
    if (n >= MAX_ENDPOINTS) return { ok: false, error: `A workspace can have up to ${MAX_ENDPOINTS} notification endpoints` };
    const secret = newSigningSecret();
    const id = newId();
    await db.insert(s.webhookEndpoints).values({ id, projectId: project.id, format: f.format, description: f.description ?? null, events: f.events, ...seal(url, secret), createdBy: user.id });
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "webhook_endpoint.create", target: id, data: { host: new URL(url).hostname, format: f.format, events: f.events } });
    done();
    return { ok: true, data: { secret, id }, message: "Endpoint added — send a test to check it" };
  } catch (e) {
    return fail(e);
  }
}

export async function updateEndpointEventsAction(endpointId: string, events: string[]): Promise<ActionResult> {
  try {
    const { project, db, user } = await notificationsGuard();
    const ev = z.array(z.string().refine((e) => EVENT_KEYS.includes(e))).min(1, "Pick at least one event").parse(events);
    const r = await db.update(s.webhookEndpoints).set({ events: ev, updatedAt: new Date() }).where(and(eq(s.webhookEndpoints.id, endpointId), eq(s.webhookEndpoints.projectId, project.id))).returning({ id: s.webhookEndpoints.id });
    if (!r.length) return { ok: false, error: "Endpoint not found" };
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "webhook_endpoint.events", target: endpointId, data: { events: ev } });
    done();
    return { ok: true, message: "Events saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Turning an endpoint back on clears its failure streak. */
export async function setEndpointEnabledAction(endpointId: string, enabled: boolean): Promise<ActionResult> {
  try {
    const { project, db, user } = await notificationsGuard();
    const r = await db
      .update(s.webhookEndpoints)
      .set({ enabled, ...(enabled ? { consecutiveFailures: 0, disabledReason: null } : { disabledReason: "Turned off by a team member" }), updatedAt: new Date() })
      .where(and(eq(s.webhookEndpoints.id, endpointId), eq(s.webhookEndpoints.projectId, project.id)))
      .returning({ id: s.webhookEndpoints.id });
    if (!r.length) return { ok: false, error: "Endpoint not found" };
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: enabled ? "webhook_endpoint.enable" : "webhook_endpoint.disable", target: endpointId });
    done();
    return { ok: true, message: enabled ? "Endpoint on" : "Endpoint off" };
  } catch (e) {
    return fail(e);
  }
}

export async function rotateEndpointSecretAction(endpointId: string): Promise<ActionResult<{ secret: string }>> {
  try {
    const { project, db, user } = await notificationsGuard();
    const [ep] = await db.select({ sealed: s.webhookEndpoints.sealed }).from(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.id, endpointId), eq(s.webhookEndpoints.projectId, project.id)));
    if (!ep) return { ok: false, error: "Endpoint not found" };
    const secret = newSigningSecret();
    await db.update(s.webhookEndpoints).set({ ...seal(unseal(ep.sealed).url, secret), updatedAt: new Date() }).where(eq(s.webhookEndpoints.id, endpointId));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "webhook_endpoint.rotate", target: endpointId });
    done();
    return { ok: true, data: { secret }, message: "Secret rotated — update your receiver" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEndpointAction(endpointId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await notificationsGuard();
    const r = await db.delete(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.id, endpointId), eq(s.webhookEndpoints.projectId, project.id))).returning({ id: s.webhookEndpoints.id });
    if (!r.length) return { ok: false, error: "Endpoint not found" };
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "webhook_endpoint.delete", target: endpointId });
    done();
    return { ok: true, message: "Endpoint removed" };
  } catch (e) {
    return fail(e);
  }
}

export async function testEndpointAction(endpointId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await notificationsGuard();
    await limited(`webhook-test:${user.id}`, 6, 0.1);
    const r = await sendTest(db, project.id, endpointId);
    done();
    return r.ok ? { ok: true, message: `Delivered (HTTP ${r.status}, ${r.durationMs} ms)` } : { ok: false, error: `Test failed: ${r.error}` };
  } catch (e) {
    return fail(e);
  }
}

export async function redeliverAction(deliveryId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await notificationsGuard();
    await limited(`webhook-redeliver:${user.id}`, 10, 0.1);
    await redeliver(db, project.id, deliveryId);
    void import("@/server/jobs/worker").then((w) => w.kickWorker());
    done();
    return { ok: true, message: "Queued for redelivery" };
  } catch (e) {
    return fail(e);
  }
}
