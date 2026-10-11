"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { createExperimentFromOpportunity, launchExperiment } from "@/server/domain/growth/experiments";
import { runLearning } from "@/server/domain/growth/learning-run";
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
    const { log, push } = collector();
    const r = await launchExperiment(db, { projectId: project.id, experimentId, tranche, log: push });
    revalidatePath("/app", "layout");
    if (r.verdict === "NOT_PROPOSED") return { ok: false, error: r.message };
    return { ok: true, data: r, log, message: r.verdict === "APPROVAL_REQUIRED" ? "Sent to the Approval Inbox" : r.verdict === "DENY" ? `Denied by policy: ${r.message}` : `Payment ${r.state.toLowerCase()}` };
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
