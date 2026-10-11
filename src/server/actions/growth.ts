"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { createExperimentFromOpportunity, isPayableAddress, launchExperiment, recordDelivery } from "@/server/domain/growth/experiments";
import { resolveApproval } from "@/server/domain/agent/execute";
import { runLearning } from "@/server/domain/growth/learning-run";
import { recordConversion } from "@/server/domain/growth/attribution";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { toMicro } from "@/lib/money";
import { collector, fail, guard, type ActionResult } from "@/server/actions/_common";

export async function createExperimentAction(opportunityId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { project, db } = await guard("operate");
    const [o] = await db.select().from(s.opportunities).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.projectId, project.id)));
    if (!o) return { ok: false, error: "Opportunity not found" };
    const { log, push } = collector();
    const exp = await createExperimentFromOpportunity(db, { projectId: project.id, opportunityId, log: push });
    revalidatePath("/app", "layout");
    return { ok: true, data: { id: exp.id }, log, message: `Experiment #${exp.number} created` };
  } catch (e) {
    return fail(e);
  }
}

export async function launchExperimentAction(experimentId: string, tranche: "first" | "second" = "first"): Promise<ActionResult> {
  try {
    const { project, db } = await guard("operate");
    const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
    if (!x) return { ok: false, error: "Experiment not found" };
    if (x.channel === "creator_program") return { ok: false, error: "Manage this campaign and its rewards from Creator campaigns" };
    const { log, push } = collector();
    const r = await launchExperiment(db, { projectId: project.id, experimentId, tranche, log: push });
    revalidatePath("/app", "layout");
    if (r.verdict === "DENY") return { ok: false, error: `Blocked by your spending rules: ${r.message}. The receipt has every check.` };
    if (r.state === "FAILED") return { ok: false, error: `Approved, but the payment failed: ${r.message}` };
    return { ok: true, data: r, log, message: r.verdict === "APPROVAL_REQUIRED" ? "Sent to Approvals — payments to people always need your OK" : `Payment ${r.state.toLowerCase()}` };
  } catch (e) {
    return fail(e);
  }
}

const Recipient = z.object({
  address: z.string().trim().refine(isPayableAddress, "Enter a valid 0x… USDC address on Arc (42 characters)"),
  label: z.string().trim().max(80).optional(),
});

/** Who a non-creator experiment pays (a writer, a community, a bounty winner). */
export async function setExperimentRecipientAction(experimentId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_wallet");
    const f = Recipient.parse({ address: form.get("address"), label: form.get("label") || undefined });
    const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
    if (!x) return { ok: false, error: "Experiment not found" };
    if (x.channel === "creator_program") return { ok: false, error: "Manage this campaign and its rewards from Creator campaigns" };
    if (["succeeded", "failed", "stopped"].includes(x.status)) return { ok: false, error: `This experiment is ${x.status}` };
    await db.update(s.experiments).set({ recipientAddress: f.address, recipientLabel: f.label ?? null, updatedAt: new Date() }).where(eq(s.experiments.id, x.id));
    // Old and new address on record: payee changes are reviewed at approval time (see agent/payees.ts).
    if ((x.recipientAddress ?? "").toLowerCase() !== f.address.toLowerCase()) await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "experiment.recipient", target: x.id, data: { from: x.recipientAddress ?? null, to: f.address, label: f.label ?? null } });
    revalidatePath(`/app/experiments/${x.id}`);
    return { ok: true, message: "Recipient saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Run an experiment without paying anyone — the founder does the work (posts, replies, outreach) and results are still measured. */
export async function startExperimentAction(experimentId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
    if (!x) return { ok: false, error: "Experiment not found" };
    if (x.channel === "creator_program") return { ok: false, error: "Manage this campaign and its rewards from Creator campaigns" };
    if (x.status !== "proposed") return { ok: false, error: `Only a proposed experiment can be started (this one is ${x.status.replace(/_/g, " ")})` };
    const now = new Date();
    await db.update(s.experiments).set({ status: "running", startsAt: now, endsAt: new Date(now.getTime() + x.timeframeDays * 86_400_000), updatedAt: now }).where(eq(s.experiments.id, x.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "experiment.start_unpaid", target: x.id });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Experiment #${x.number} is running — use its tracked link and record results as they come in` };
  } catch (e) {
    return fail(e);
  }
}

/** Stop an experiment by hand. Any payment still waiting for approval is rejected with it. */
export async function stopExperimentAction(experimentId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
    if (!x) return { ok: false, error: "Experiment not found" };
    if (x.channel === "creator_program") return { ok: false, error: "Manage this campaign and its rewards from Creator campaigns" };
    if (!["proposed", "awaiting_approval", "running"].includes(x.status)) return { ok: false, error: `This experiment is already ${x.status}` };
    const txIds = (await db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.experimentId, x.id))).map((t) => t.id);
    const pending = txIds.length ? await db.select().from(s.approvals).where(and(eq(s.approvals.projectId, project.id), eq(s.approvals.status, "pending"), inArray(s.approvals.transactionId, txIds))) : [];
    for (const a of pending) await resolveApproval(db, { approvalId: a.id, userId: user.id, resolution: "reject", note: "experiment stopped by founder" });
    await db.update(s.experiments).set({ status: "stopped", outcome: { ...(x.outcome ?? {}), verdict: "STOPPED", reason: "Stopped by the founder" }, endsAt: new Date(), updatedAt: new Date() }).where(eq(s.experiments.id, x.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "experiment.stop", target: x.id });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Experiment #${x.number} stopped${pending.length ? ` and ${pending.length} pending payment(s) rejected` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissOpportunityAction(opportunityId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await db.update(s.opportunities).set({ status: "dismissed", updatedAt: new Date() }).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.projectId, project.id)));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "opportunity.dismiss", target: opportunityId });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Dismissed" };
  } catch (e) {
    return fail(e);
  }
}

export async function runLearningAction(): Promise<ActionResult> {
  try {
    const { project, db } = await guard("operate");
    const [m] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, project.id), eq(s.missions.status, "active")));
    if (!m) return { ok: false, error: "No active mission" };
    const { log, push } = collector();
    await runLearning(db, { projectId: project.id, missionId: m.id, log: push });
    revalidatePath("/app", "layout");
    return { ok: true, log, message: "Learning complete" };
  } catch (e) {
    return fail(e);
  }
}

const ManualConversion = z.object({
  event: z.enum(CONVERSION_EVENTS),
  count: z.coerce.number().int().min(1, "Count must be at least 1").max(500),
  value: z.string().regex(/^\d+(\.\d{1,6})?$/, "Value must be an amount like 12.50").optional(),
  note: z.string().max(300).optional(),
});

/**
 * Founder-reported conversions for businesses without a webhook — e.g. orders where the
 * customer quoted the referral code. Stored with source "manual" so they stay distinguishable.
 */
export async function recordManualConversionAction(experimentId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    const [camp] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, experimentId));
    const [x] = await db.select({ id: s.experiments.id }).from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
    if (!x || !camp) return { ok: false, error: "Experiment not found" };
    const opt = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const f = ManualConversion.parse({ event: form.get("event"), count: form.get("count") || 1, value: opt("value"), note: opt("note") });
    const total = f.value ? toMicro(f.value) : 0;
    const each = Math.floor(total / f.count);
    const remainder = total % f.count;
    await db.transaction(async (tx) => {
    for (let i = 0; i < f.count; i++) {
      await recordConversion(tx as unknown as typeof db, {
        projectId: project.id,
        eventType: f.event,
        referralCode: camp.referralCode,
        idempotencyKey: `manual:${experimentId}:${randomUUID()}`,
        source: "manual",
        valueMicro: each + (i < remainder ? 1 : 0),
        metadata: { recordedBy: user.id, ...(f.note ? { note: f.note } : {}) },
        dataMode: "LIVE",
      });
    }
    await audit(tx as unknown as typeof db, { projectId: project.id, actorType: "user", actorId: user.id, action: "conversion.manual", target: experimentId, data: { event: f.event, count: f.count, valueMicro: total } });
    });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Recorded ${f.count} ${f.event.replace(/_/g, " ")}${f.count === 1 ? "" : "s"}` };
  } catch (e) {
    return fail(e);
  }
}

/** Record where the paid work lives (post, article, merged PR). Tranche 2 pays on delivery. */
export async function recordDeliveryAction(experimentId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await recordDelivery(db, { projectId: project.id, experimentId, userId: user.id, url: String(form.get("url") ?? ""), note: String(form.get("note") ?? "") || null });
    revalidatePath(`/app/experiments/${experimentId}`);
    return { ok: true, message: "Delivery recorded — tranche 2 can be released" };
  } catch (e) {
    return fail(e);
  }
}
