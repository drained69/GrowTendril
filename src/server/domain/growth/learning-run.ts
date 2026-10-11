import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mergeMode } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { fmtUsdc, toMicro } from "@/lib/money";
import { parseFinancialAction } from "@/server/domain/agent/actions";
import { evaluatePolicy } from "@/server/domain/agent/policy";
import { loadPolicy, loadPolicyState, PENDING_STATES, SPENT_STATES } from "@/server/domain/agent/ledger";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import type { Logger } from "@/server/domain/intel/analyze";
import { missionPerformance } from "@/server/domain/growth/attribution";
import { evaluateExperiments, experimentOutcome, planReallocation, type Reallocation } from "@/server/domain/growth/learning";

/**
 * BUDGET AGENT — measured results in, reallocation out. Findings come from the ledger and
 * attribution tables; the move is a structured `reallocate_budget` action through policy.
 */
export async function runLearning(db: DB, p: { projectId: string; missionId: string; runId?: string | null; log?: Logger }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${p.projectId}`}))`);
    const [mission] = await tx.select({ id: s.missions.id }).from(s.missions).where(and(eq(s.missions.id, p.missionId), eq(s.missions.projectId, p.projectId), eq(s.missions.status, "active")));
    if (!mission) throw new Error("No active mission in this workspace");
    return runLearningLocked(tx as unknown as DB, p);
  });
}

async function runLearningLocked(db: DB, p: Parameters<typeof runLearning>[1]) {
  const log = p.log ?? (() => {});
  const perf = (await missionPerformance(db, p.missionId)).filter(x => x.channel !== "creator_program");
  if (!perf.length) return { findings: [], moves: [], decisionId: null as string | null, verdict: null as string | null };
  for (const x of perf) {
    const done = experimentOutcome(x, Date.now());
    if (!done) continue;
    await db
      .update(s.experiments)
      .set({ status: done.status, outcome: { verdict: done.status.toUpperCase(), reason: done.reason, conversions: x.conversions, spentMicro: x.spentMicro }, endsAt: x.endsAt ?? new Date(), updatedAt: new Date() })
      .where(eq(s.experiments.id, x.experimentId));
    x.status = done.status;
    log("attribution", `#${x.number} ${x.title}: ${done.status} — ${done.reason}`);
  }
  const findings = evaluateExperiments(perf);
  for (const f of findings) log("attribution", `${f.label}: ${fmtUsdc(f.spentMicro)} → ${f.conversions} conv, CPA ${f.cpaMicro == null ? "—" : fmtUsdc(f.cpaMicro)} → ${f.verdict}`);

  // Experiments that hit their stop condition stop now, regardless of reallocation.
  for (const f of findings.filter((x) => x.verdict === "STOP" && ["running", "awaiting_approval"].includes(perf.find((p) => p.experimentId === x.experimentId)?.status ?? ""))) {
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
  const remaining = Object.fromEntries(perf.map((x) => [x.experimentId, Math.max(0, x.budgetMicro - Math.max(x.spentMicro, x.committedMicro ?? x.spentMicro))]));
  const policy = await loadPolicy(db, p.projectId);
  const pstate = await loadPolicyState(db, { projectId: p.projectId, missionId: p.missionId, category: "treasury", experimentRemainingMicro: remaining });
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
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${projectId}`}))`);
    const [mission] = await tx.select().from(s.missions).where(and(eq(s.missions.id, missionId), eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));
    if (!mission) throw new Error("No active mission in this workspace");
    const [applied] = await tx.select({ id: s.learnings.id }).from(s.learnings).where(and(eq(s.learnings.decisionId, decisionId), eq(s.learnings.projectId, projectId)));
    if (applied) return;
    const exps = await tx.select().from(s.experiments).where(and(eq(s.experiments.missionId, missionId), eq(s.experiments.projectId, projectId)));
    const byId = new Map(exps.map((e) => [e.id, e]));
    const outgoing = new Map<string, number>();
    const delta = new Map<string, number>();
    for (const m of norm) {
      const from = byId.get(m.fromExperimentId), to = byId.get(m.toExperimentId);
      if (from?.channel === "creator_program" || to?.channel === "creator_program") throw new Error("Published creator reward pools cannot be reallocated");
      if (!from || !to || from.id === to.id) throw new Error("Reallocation experiments must be distinct and belong to this workspace and mission");
      if (!Number.isSafeInteger(m.amountMicro) || m.amountMicro <= 0) throw new Error("Reallocation amount must be a positive, safe integer amount of micro-USDC");
      outgoing.set(from.id, (outgoing.get(from.id) ?? 0) + m.amountMicro);
      delta.set(from.id, (delta.get(from.id) ?? 0) - m.amountMicro);
      delta.set(to.id, (delta.get(to.id) ?? 0) + m.amountMicro);
    }
    for (const [id, amount] of outgoing) {
      const [r] = await tx.select({ total: sql<string>`coalesce(sum(${s.transactions.amountMicro}), 0)` }).from(s.transactions).where(and(eq(s.transactions.experimentId, id), inArray(s.transactions.state, [...SPENT_STATES, ...PENDING_STATES, "PROPOSED"])));
      if (amount > byId.get(id)!.budgetMicro - Number(r.total)) throw new Error("Source experiment no longer has enough uncommitted budget");
    }
    for (const [id, amount] of delta) {
      const budgetMicro = byId.get(id)!.budgetMicro + amount;
      if (!Number.isSafeInteger(budgetMicro) || budgetMicro < 0) throw new Error("Reallocation would create an invalid experiment budget");
      await tx.update(s.experiments).set({ budgetMicro, updatedAt: new Date() }).where(eq(s.experiments.id, id));
    }
    await tx.insert(s.learnings).values({ id: newId(), projectId, missionId, decisionId, findings: findings as Record<string, unknown>[], reallocations: norm as unknown as Record<string, unknown>[], dataMode: mergeMode(exps.map((e) => e.dataMode)) });
  });
}
