import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { runDiscovery } from "@/server/domain/intel/discovery";
import { refreshMarketplace } from "@/server/integrations/circle/marketplace";
import { refreshSettlements } from "@/server/domain/agent/execute";
import { purchaseCompanyIntel } from "@/server/domain/agent/purchase";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { COMMIT_THRESHOLD } from "@/server/domain/agent/information-value";
import { createExperimentFromOpportunity, launchExperiment } from "@/server/domain/growth/experiments";
import { runLearning } from "@/server/domain/growth/learning-run";
import { buildDailyBrief } from "@/server/domain/growth/brief";
import { notify } from "@/server/domain/notifications/webhooks";

/**
 * OPERATOR — one autonomous cycle of the loop:
 *   DISCOVER → UNDERSTAND → VERIFY (buy data if worth it) → DECIDE → SPEND (via policy)
 *   → EXECUTE → MEASURE → ATTRIBUTE → LEARN → REALLOCATE → brief
 * Each step is deterministic code; the founder sets goal, budget and rules, not steps.
 */
export async function runCycle(db: DB, projectId: string, opts: { trigger?: "manual" | "schedule"; maxPurchases?: number; maxNewExperiments?: number } = {}) {
  const [run] = await db.insert(s.agentRuns).values({ id: newId(), projectId, trigger: opts.trigger ?? "manual", status: "running" }).returning();
  const lines: { at: string; agent: string; message: string }[] = [];
  const log = (agent: string, message: string) => lines.push({ at: new Date().toISOString(), agent, message });
  const stats: Record<string, unknown> = {};
  try {
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
    const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));

    // DISCOVER + UNDERSTAND
    if (!project) throw new Error("Workspace not found");
    if (project.dataMode === "DEMO") throw new Error("Demo workspaces are no longer supported");
    const d = await runDiscovery(db, projectId, log);
    stats.analysis = d.stats;
    stats.fetched = d.fetched;

    // Keep the live service catalog fresh.
    const mk = await refreshMarketplace(db);
    log("operator", mk.error ? `Agent Marketplace unreachable: ${mk.error}` : `Agent Marketplace: ${mk.found} services, ${mk.arcPayable} payable on Arc`);

    const settle = await refreshSettlements(db, projectId);
    if (settle.checked) log("operator", `Checked ${settle.checked} in-flight settlement(s), ${settle.updated} updated`);

    if (!mission) {
      log("operator", "No active mission — nothing to spend against. Create one to let GrowTendril act.");
    } else {
      // Product friction gates paid acquisition.
      const blocking = await db.select().from(s.productIssues).where(and(eq(s.productIssues.projectId, projectId), eq(s.productIssues.blocksAcquisition, true)));

      // VERIFY: buy information where the expected value justifies it.
      const toVerify = (await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId), eq(s.opportunities.type, "CUSTOMER"), eq(s.opportunities.status, "open"))).orderBy(desc(s.opportunities.overallScore)))
        .filter((o) => o.confidence < COMMIT_THRESHOLD && o.overallScore >= 55)
        .slice(0, opts.maxPurchases ?? 1);
      for (const o of toVerify) {
        const r = await purchaseCompanyIntel(db, { projectId, companyId: o.companyId!, runId: run.id, log });
        stats.purchases = [...((stats.purchases as unknown[]) ?? []), r];
      }

      // DECIDE + SPEND: high-confidence opportunities become experiments.
      const ready = (await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId), eq(s.opportunities.status, "open"), inArray(s.opportunities.type, ["KOL", "NARRATIVE", "CUSTOMER"]))).orderBy(desc(s.opportunities.overallScore)))
        .filter((o) => o.confidence >= COMMIT_THRESHOLD && o.expectedValue !== "LOW")
        .slice(0, opts.maxNewExperiments ?? 1);
      for (const o of ready) {
        if (blocking.length && o.type !== "CUSTOMER") {
          const d = await recordDecision(db, {
            projectId,
            missionId: mission.id,
            runId: run.id,
            agent: "operator",
            kind: "hold_acquisition",
            action: { action: "hold_acquisition", opportunityId: o.id, issueId: blocking[0].id },
            rationale: `Holding paid acquisition for opportunity #${o.number}: "${blocking[0].label}" is growing (+${blocking[0].changePct}% WoW). Paying for more traffic now would mostly buy more of that friction.`,
            inputs: { reasons: [blocking[0].recommendation ?? ""] },
            status: "executed",
            dataMode: o.dataMode,
          });
          await writeReceipt(db, d.id);
          log("operator", `Held acquisition for #${o.number} — fix "${blocking[0].label}" first`);
          continue;
        }
        let exp: Awaited<ReturnType<typeof createExperimentFromOpportunity>>;
        try {
          exp = await createExperimentFromOpportunity(db, { projectId, opportunityId: o.id, runId: run.id, log });
        } catch (e) {
          // A full budget or missing destination URL is a normal state, not a failed cycle.
          log("strategist", `No new experiment for #${o.number}: ${(e as Error).message}`);
          break;
        }
        if (exp.status === "proposed") {
          if (o.type === "KOL") {
            try {
              const res = await launchExperiment(db, { projectId, experimentId: exp.id, runId: run.id, log });
              log("operator", `Launch EXP #${exp.number}: ${res.verdict} → ${res.state}`);
            } catch (e) {
              log("operator", `Experiment #${exp.number} awaits a verified creator payout address: ${(e as Error).message}`);
            }
          } else log("operator", `Experiment #${exp.number} is proposed. Choose a recipient and scope before requesting payment.`);
        }
      }

      // MEASURE → ATTRIBUTE → LEARN → REALLOCATE
      const learn = await runLearning(db, { projectId, missionId: mission.id, runId: run.id, log });
      stats.learning = { findings: learn.findings.length, moves: learn.moves.length, verdict: learn.verdict };
    }

    stats.brief = await buildDailyBrief(db, projectId);
    await db.update(s.agentRuns).set({ status: "completed", stats, log: lines, finishedAt: new Date() }).where(eq(s.agentRuns.id, run.id));
    await notify(db, projectId, { event: "cycle.finished", key: `cycle.finished:${run.id}`, summary: "Operator cycle finished", path: "/app/runs", data: { run_id: run.id } });
  } catch (e) {
    log("operator", `Cycle failed: ${(e as Error).message}`);
    await db.update(s.agentRuns).set({ status: "failed", stats, log: lines, finishedAt: new Date() }).where(eq(s.agentRuns.id, run.id));
    throw e;
  }
  return { runId: run.id, log: lines, stats };
}
