import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { categorySpend, missionSpend, PENDING_STATES } from "@/server/domain/agent/ledger";
import { missionPerformance, missionProgress } from "@/server/domain/growth/attribution";
import { cpa, evaluateExperiments, growthEfficiency, type ExperimentPerformance } from "@/server/domain/growth/learning";
import { DAY_MS } from "@/lib/time";

export const CATEGORY_LABEL: Record<string, string> = { research: "Research", services: "Services", kol: "KOLs", bounty: "Bounties", content: "Content", community: "Community", treasury: "Treasury" };

export const OPEN_EXPERIMENT_STATUSES = ["proposed", "awaiting_approval", "running"];

/**
 * Pure budget arithmetic shared by every screen that shows "Available":
 * available = budget − spent − awaiting approval − reserved by open experiments.
 * An open experiment reserves its unspent budget; payments of that experiment already awaiting
 * approval sit inside that reservation, so they are only counted once.
 */
export function budgetAvailability(input: {
  budgetMicro: number;
  spentMicro: number;
  awaitingApprovalMicro: number;
  openExperiments: { id: string; budgetMicro: number; spentMicro: number }[];
  awaitingByExperiment: Record<string, number>;
}) {
  let reserved = 0;
  let pendingInsideReservations = 0;
  for (const x of input.openExperiments) {
    const unspent = Math.max(0, x.budgetMicro - x.spentMicro);
    const awaiting = input.awaitingByExperiment[x.id] ?? 0;
    pendingInsideReservations += Math.min(awaiting, unspent);
    reserved += unspent;
  }
  const awaitingApproval = Math.max(0, input.awaitingApprovalMicro - pendingInsideReservations);
  const committed = reserved + awaitingApproval;
  return {
    budget: input.budgetMicro,
    spent: input.spentMicro,
    /** Awaiting approval and not already inside an experiment reservation. */
    awaitingApproval,
    /** Unspent budget held by open (proposed / awaiting approval / running) experiments. */
    reserved,
    committed,
    available: Math.max(0, input.budgetMicro - input.spentMicro - committed),
  };
}

/** Budget availability for a mission from the ledger: the single source for "Available". */
export async function missionBudget(db: DB, mission: typeof s.missions.$inferSelect, perf?: ExperimentPerformance[]) {
  const { spent, pending } = await missionSpend(db, mission.id);
  const rows = perf ?? (await missionPerformance(db, mission.id));
  const awaiting = await db
    .select({ experimentId: s.transactions.experimentId, n: sql<string>`coalesce(sum(${s.transactions.amountMicro}),0)` })
    .from(s.transactions)
    .where(and(eq(s.transactions.missionId, mission.id), inArray(s.transactions.state, PENDING_STATES), sql`${s.transactions.budgetCategory} <> 'treasury'`))
    .groupBy(s.transactions.experimentId);
  const awaitingByExperiment = Object.fromEntries(awaiting.filter((a) => a.experimentId).map((a) => [a.experimentId!, Number(a.n)]));
  return budgetAvailability({
    budgetMicro: mission.budgetMicro,
    spentMicro: spent,
    awaitingApprovalMicro: pending,
    openExperiments: rows.filter((p) => OPEN_EXPERIMENT_STATUSES.includes(p.status)).map((p) => ({ id: p.experimentId, budgetMicro: p.budgetMicro, spentMicro: p.spentMicro })),
    awaitingByExperiment,
  });
}

/** Budget + progress numbers for a mission, computed from the ledger and attribution only. */
export async function missionSummary(db: DB, mission: typeof s.missions.$inferSelect) {
  const exps = await db.select().from(s.experiments).where(eq(s.experiments.missionId, mission.id));
  const perf = await missionPerformance(db, mission.id);
  const budget = await missionBudget(db, mission, perf);
  const { spent, committed, available } = budget;
  const progress = await missionProgress(db, mission);
  const findings = evaluateExperiments(perf);
  const successful = exps.filter((x) => (x.outcome as { verdict?: string } | null)?.verdict === "SCALE" || x.status === "succeeded").length;
  const allocs = await db.select().from(s.missionBudgets).where(eq(s.missionBudgets.missionId, mission.id));
  const allocation = await Promise.all(
    allocs.map(async (a) => ({ category: a.category, allocated: a.allocatedMicro, used: await categorySpend(db, mission.id, a.category) })),
  );
  const elapsed = Math.min(1, Math.max(0, (Date.now() - mission.startsAt.getTime()) / (mission.endsAt.getTime() - mission.startsAt.getTime())));
  return {
    spent,
    pending: budget.awaitingApproval,
    reserved: budget.reserved,
    committed,
    available,
    achieved: progress.achieved,
    attributed: progress.attributed,
    costPerQualified: cpa(spent, progress.attributed),
    experiments: exps.length,
    successful,
    efficiency: growthEfficiency({ goal: mission.goalTarget, achieved: progress.achieved, budgetMicro: mission.budgetMicro, spentMicro: spent, experiments: exps.length, successful }),
    pace: mission.goalTarget * elapsed,
    daysLeft: Math.max(0, Math.ceil((mission.endsAt.getTime() - Date.now()) / DAY_MS)),
    perf,
    findings,
    allocation,
  };
}

export async function activeMission(db: DB, projectId: string) {
  const [m] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));
  return m ?? null;
}

