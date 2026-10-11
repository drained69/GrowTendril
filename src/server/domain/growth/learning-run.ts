import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mergeMode } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { fmtUsdc, toMicro } from "@/lib/money";
import { parseFinancialAction } from "@/server/domain/agent/actions";
import { evaluatePolicy } from "@/server/domain/agent/policy";
import { loadPolicy, loadPolicyState } from "@/server/domain/agent/ledger";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import type { Logger } from "@/server/domain/intel/analyze";
import { missionPerformance } from "@/server/domain/growth/attribution";
import { evaluateExperiments, planReallocation, type Reallocation } from "@/server/domain/growth/learning";

/**
 * BUDGET AGENT — measured results in, reallocation out. Findings come from the ledger and
 * attribution tables; the move is a structured `reallocate_budget` action through policy.
 */
export async function runLearning(db: DB, p: { projectId: string; missionId: string; runId?: string | null; log?: Logger }) {
  const log = p.log ?? (() => {});
  const perf = await missionPerformance(db, p.missionId);
  if (!perf.length) return { findings: [], moves: [], decisionId: null as string | null, verdict: null as string | null };
  const findings = evaluateExperiments(perf);
  for (const f of findings) log("attribution", `${f.label}: ${fmtUsdc(f.spentMicro)} → ${f.conversions} conv, CPA ${f.cpaMicro == null ? "—" : fmtUsdc(f.cpaMicro)} → ${f.verdict}`);

  // Experiments that hit their stop condition stop now, regardless of reallocation.
  for (const f of findings.filter((x) => x.verdict === "STOP")) {
    await db.update(s.experiments).set({ status: "stopped", outcome: { verdict: "STOP", reason: f.reason, cpaMicro: f.cpaMicro, conversions: f.conversions }, updatedAt: new Date() }).where(eq(s.experiments.id, f.experimentId));
  }
  for (const f of findings.filter((x) => x.verdict === "SCALE")) {
    await db.update(s.experiments).set({ outcome: { verdict: "SCALE", reason: f.reason, cpaMicro: f.cpaMicro, conversions: f.conversions }, updatedAt: new Date() }).where(eq(s.experiments.id, f.experimentId));
  }

  const moves = planReallocation(perf, findings);
  const exps = await db.select().from(s.experiments).where(eq(s.experiments.missionId, p.missionId));
  const mode = mergeMode(exps.map((e) => e.dataMode));
  if (!moves.length) {
    await db.insert(s.learnings).values({ id: newId(), projectId: p.projectId, missionId: p.missionId, findings: findings as unknown as Record<string, unknown>[], reallocations: [], dataMode: mode });
    log("budget", "No reallocation warranted yet");
    return { findings, moves, decisionId: null, verdict: null };
  }

  const parsed = parseFinancialAction({
    action: "reallocate_budget",
    missionId: p.missionId,
    reasonCode: "REALLOCATE_TO_WINNER",
    confidence: 0.85,
    moves: moves.map((m) => ({ fromExperimentId: m.fromExperimentId, toExperimentId: m.toExperimentId, amount: m.amount, reason: m.reason.slice(0, 400) })),
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  const remaining = Object.fromEntries(perf.map((x) => [x.experimentId, Math.max(0, x.budgetMicro - x.spentMicro)]));
  const policy = await loadPolicy(db, p.projectId);
  const pstate = await loadPolicyState(db, { projectId: p.projectId, missionId: p.missionId, category: "treasury", experimentRemainingMicro: remaining, balances: false });
  const verdict = evaluatePolicy(parsed.data, policy, pstate);
  const total = moves.reduce((sum, m) => sum + m.amountMicro, 0);
  const decision = await recordDecision(db, {
    projectId: p.projectId,
    missionId: p.missionId,
    runId: p.runId,
    agent: "budget",
    kind: "reallocate_budget",
    action: parsed.data as unknown as Record<string, unknown>,
    rationale: `Move ${fmtUsdc(total)} of unspent budget toward the channels with the lowest measured cost per ${perf[0] ? "conversion" : "result"}.`,
    inputs: { reasons: findings.map((f) => `${f.label}: ${f.reason}`) },
    policy: verdict,
    status: verdict.verdict === "ALLOW" ? "executed" : verdict.verdict === "DENY" ? "denied" : "awaiting_approval",
    autonomous: verdict.verdict === "ALLOW",
    dataMode: mode,
  });
  if (verdict.verdict === "ALLOW") await applyReallocation(db, p.projectId, p.missionId, decision.id, moves, findings);
  else if (verdict.verdict === "APPROVAL_REQUIRED")
    await db.insert(s.approvals).values({ id: newId(), projectId: p.projectId, decisionId: decision.id, title: `Reallocate ${fmtUsdc(total)} between experiments`, details: { moves, findings, policy: verdict.checks.filter((c) => !c.passed) }, requestedMicro: total });
  await writeReceipt(db, decision.id);
  log("budget", `Reallocation of ${fmtUsdc(total)} → ${verdict.verdict}`);
  return { findings, moves, decisionId: decision.id, verdict: verdict.verdict };
}

/** Apply moves: lower source budgets (unspent only), raise target budgets. Budgets only — no funds move. */
export async function applyReallocation(db: DB, projectId: string, missionId: string, decisionId: string, moves: Reallocation[] | { fromExperimentId: string; toExperimentId: string; amount: string; reason: string }[], findings: unknown[] = []) {
  const norm = moves.map((m) => ({ ...m, amountMicro: "amountMicro" in m ? m.amountMicro : toMicro(m.amount) }));
  for (const m of norm) {
    const [from] = await db.select().from(s.experiments).where(eq(s.experiments.id, m.fromExperimentId));
    const [to] = await db.select().from(s.experiments).where(eq(s.experiments.id, m.toExperimentId));
    await db.update(s.experiments).set({ budgetMicro: from.budgetMicro - m.amountMicro, updatedAt: new Date() }).where(eq(s.experiments.id, from.id));
    await db.update(s.experiments).set({ budgetMicro: to.budgetMicro + m.amountMicro, updatedAt: new Date() }).where(eq(s.experiments.id, to.id));
  }
  const exps = await db.select().from(s.experiments).where(eq(s.experiments.missionId, missionId));
  await db.insert(s.learnings).values({ id: newId(), projectId, missionId, decisionId, findings: findings as Record<string, unknown>[], reallocations: norm as unknown as Record<string, unknown>[], dataMode: mergeMode(exps.map((e) => e.dataMode)) });
}
