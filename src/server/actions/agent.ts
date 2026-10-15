"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { schema as s } from "@/server/db/client";
import { enqueue, activeJob } from "@/server/jobs/queue";
import { kickWorker } from "@/server/jobs/worker";
import { purchaseCompanyIntel } from "@/server/domain/agent/purchase";
import { buildDailyBrief } from "@/server/domain/growth/brief";
import { generateKolBrief } from "@/server/domain/growth/kol-brief";
import { balanceMicro, canAfford, chargeService, InsufficientCredit, refundCharge } from "@/server/domain/billing";
import { newId } from "@/server/lib/ids";
import { collector, fail, guard, limited, type ActionResult, type LogLine } from "@/server/actions/_common";

/** Queue an operator cycle. The worker runs it; the client polls jobStatusAction for progress. */
export async function runCycleAction(): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { project, db, user } = await guard("operate");
    await limited(`cycle:${user.id}`, 4, 1 / 60);
    const existing = await activeJob(db, project.id, "cycle");
    if (existing) return { ok: true, data: { jobId: existing.id }, message: "A cycle is already queued or running" };
    // The scan is charged when the worker starts it; check now so the person hears why at once.
    if (!(await canAfford(db, project.ownerId, "scan"))) return { ok: false, error: new InsufficientCredit("scan", await balanceMicro(db, project.ownerId)).message, code: "INSUFFICIENT_CREDIT", nextHref: project.ownerId === user.id ? "/billing" : "/app/team" };
    const job = await enqueue(db, { kind: "cycle", projectId: project.id, trigger: "user", maxAttempts: 1 });
    kickWorker();
    return { ok: true, data: { jobId: job!.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function jobStatusAction(jobId: string): Promise<ActionResult<{ status: string; log: LogLine[]; error: string | null; skipped: string | null }>> {
  try {
    const { project, db } = await guard("view");
    const [job] = await db.select().from(s.jobs).where(and(eq(s.jobs.id, jobId), eq(s.jobs.projectId, project.id)));
    if (!job) return { ok: false, error: "Job not found" };
    let log: LogLine[] = [];
    const runId = (job.result as { runId?: string } | null)?.runId;
    const [run] = runId
      ? await db.select().from(s.agentRuns).where(eq(s.agentRuns.id, runId))
      : job.status === "running"
        ? await db.select().from(s.agentRuns).where(and(eq(s.agentRuns.projectId, project.id), eq(s.agentRuns.status, "running")))
        : [];
    if (run) log = run.log.map((l) => ({ agent: l.agent, message: l.message }));
    if (job.status === "done" || job.status === "failed") revalidatePath("/app", "layout");
    const skipped = (job.result as { skipped?: unknown } | null)?.skipped;
    return { ok: true, data: { status: job.status, log, error: job.lastError, skipped: typeof skipped === "string" ? skipped : null } };
  } catch (e) {
    return fail(e);
  }
}

export async function purchaseIntelAction(companyId: string): Promise<ActionResult> {
  try {
    const { project, db } = await guard("operate");
    const [c] = await db.select().from(s.companies).where(and(eq(s.companies.id, companyId), eq(s.companies.projectId, project.id)));
    if (!c) return { ok: false, error: "Company not found" };
    const { log, push } = collector();
    const r = await purchaseCompanyIntel(db, { projectId: project.id, companyId, log: push });
    revalidatePath("/app", "layout");
    return { ok: true, data: r, log, message: r.message };
  } catch (e) {
    return fail(e);
  }
}

export async function generateBriefAction(kolId: string, experimentId?: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    const [k] = await db.select().from(s.kols).where(and(eq(s.kols.id, kolId), eq(s.kols.projectId, project.id)));
    if (!k) return { ok: false, error: "Creator not found" };
    if (experimentId) {
      const [x] = await db.select({ id: s.experiments.id }).from(s.experiments).where(and(eq(s.experiments.id, experimentId), eq(s.experiments.projectId, project.id)));
      if (!x) return { ok: false, error: "Experiment not found" };
    }
    const ref = `brief:${newId()}`;
    await chargeService(db, { ownerId: project.ownerId, projectId: project.id, service: "campaign_brief", ref, actorId: user.id, note: `@${k.handle}` });
    try {
      await generateKolBrief(db, kolId, experimentId);
    } catch (e) {
      await refundCharge(db, ref, "Brief failed — refunded");
      throw e;
    }
    revalidatePath(`/app/kols/${kolId}`, "layout");
    return { ok: true, message: "Brief regenerated" };
  } catch (e) {
    return fail(e);
  }
}

export async function rebuildDailyBriefAction(): Promise<ActionResult> {
  try {
    const { project, db } = await guard("operate");
    await buildDailyBrief(db, project.id);
    revalidatePath("/app/brief");
    return { ok: true, message: "Brief rebuilt" };
  } catch (e) {
    return fail(e);
  }
}
