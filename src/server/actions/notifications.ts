"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { guard, fail, limited, type ActionResult } from "@/server/actions/_common";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { enqueue } from "@/server/jobs/queue";
import { MAX_ENDPOINTS, WEBHOOK_EVENTS, maskUrl, newSigningSecret, seal, validateEndpointUrl } from "@/server/domain/notifications/webhooks";

const Form = z.object({
  format: z.enum(["json", "slack", "discord"]),
  url: z.string().trim().min(1).max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS.map((event) => event.key) as ["approval.requested", "payment.settled", "payment.failed", "cycle.finished", "creator.post_submitted"])).min(1),
});
const refresh = () => revalidatePath("/app/integrations");

export async function createNotificationEndpointAction(_: unknown, form: FormData): Promise<ActionResult<{ secret: string }>> {
  try {
    const { user, project, db } = await guard("manage_integrations");
    if (user.isGuest) return { ok: false, error: "Create an account before sending notifications." };
    await limited(`notification-create:${user.id}`, 10, 0.05);
    const input = Form.parse({ format: form.get("format"), url: form.get("url"), events: form.getAll("events") });
    const url = validateEndpointUrl(input.url, input.format);
    const [total] = await db.select({ value: count() }).from(s.webhookEndpoints).where(eq(s.webhookEndpoints.projectId, project.id));
    if (total.value >= MAX_ENDPOINTS) return { ok: false, error: `A workspace can have at most ${MAX_ENDPOINTS} endpoints.` };
    const secret = newSigningSecret();
    const id = newId();
    await db.insert(s.webhookEndpoints).values({ id, projectId: project.id, urlHint: maskUrl(url), format: input.format, events: input.events, sealed: seal(url, secret) });
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "notification.endpoint_create", target: id, data: { format: input.format, events: input.events } });
    refresh();
    return { ok: true, data: { secret }, message: "Endpoint added. Copy the signing secret now." };
  } catch (error) { return fail(error); }
}

export async function setNotificationEndpointAction(id: string, enabled: boolean): Promise<ActionResult> {
  try {
    const { user, project, db } = await guard("manage_integrations");
    const [endpoint] = await db.update(s.webhookEndpoints).set({ enabled, updatedAt: new Date() }).where(and(eq(s.webhookEndpoints.id, id), eq(s.webhookEndpoints.projectId, project.id))).returning({ id: s.webhookEndpoints.id });
    if (!endpoint) return { ok: false, error: "Endpoint not found." };
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: enabled ? "notification.endpoint_enable" : "notification.endpoint_disable", target: id });
    refresh();
    return { ok: true, message: enabled ? "Endpoint enabled." : "Endpoint disabled." };
  } catch (error) { return fail(error); }
}

export async function deleteNotificationEndpointAction(id: string): Promise<ActionResult> {
  try {
    const { user, project, db } = await guard("manage_integrations");
    const [endpoint] = await db.delete(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.id, id), eq(s.webhookEndpoints.projectId, project.id))).returning({ id: s.webhookEndpoints.id });
    if (!endpoint) return { ok: false, error: "Endpoint not found." };
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "notification.endpoint_delete", target: id });
    refresh();
    return { ok: true, message: "Endpoint removed." };
  } catch (error) { return fail(error); }
}

export async function testNotificationEndpointAction(id: string): Promise<ActionResult> {
  try {
    const { user, project, db } = await guard("manage_integrations");
    await limited(`notification-test:${user.id}`, 6, 0.1);
    const [endpoint] = await db.select({ id: s.webhookEndpoints.id, enabled: s.webhookEndpoints.enabled }).from(s.webhookEndpoints).where(and(eq(s.webhookEndpoints.id, id), eq(s.webhookEndpoints.projectId, project.id)));
    if (!endpoint?.enabled) return { ok: false, error: "Enable this endpoint first." };
    const deliveryId = newId();
    const key = `webhook.test:${deliveryId}`;
    const origin = process.env.APP_URL?.trim().replace(/\/$/, "");
    const payload = { id: key, type: "webhook.test", created_at: new Date().toISOString(), workspace: { id: project.id, name: project.name }, summary: "Test notification from GrowTendril", url: origin ? `${origin}/app/integrations` : null, data: { test: true } };
    await db.transaction(async (tx) => {
      await tx.insert(s.webhookDeliveries).values({ id: deliveryId, endpointId: id, projectId: project.id, event: "webhook.test", eventKey: key, payload });
      await enqueue(tx as typeof db, { kind: "webhook", projectId: project.id, payload: { deliveryId }, dedupeKey: `webhook:${deliveryId}`, maxAttempts: 6 });
    });
    void import("@/server/jobs/worker").then((worker) => worker.kickWorker()).catch(() => {});
    refresh();
    return { ok: true, message: "Test queued. Check recent deliveries for the result." };
  } catch (error) { return fail(error); }
}
