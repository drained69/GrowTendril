import { assertCreatorReward } from "@/server/domain/growth/creator-reward-guard";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { startOfUtcDay } from "@/lib/time";
import { walletIsLive } from "@/server/integrations/circle/wallets";
import type { PolicyConfig, PolicyState } from "@/server/domain/agent/policy";
import { evaluatePolicy } from "@/server/domain/agent/policy";
import { parseFinancialAction } from "@/server/domain/agent/actions";
import { toMicro } from "@/lib/money";
import { updateDecision, writeReceipt } from "@/server/domain/agent/decisions";

/**
 * Transaction state machine. Every transition is validated and recorded in
 * transaction_events (the audit trail). Execution takes a row-level "lock" by
 * moving AUTHORIZED → EXECUTING with a conditional UPDATE, so two workers can
 * never pay for the same decision.
 *
 *   PROPOSED ─┬─► DENIED
 *             ├─► AWAITING_APPROVAL ─┬─► AUTHORIZED
 *             │                      └─► REJECTED
 *             └─► AUTHORIZED ─► EXECUTING ─┬─► SUBMITTED ─┬─► SETTLED
 *                                          │              └─► FAILED
 *                                          ├─► SETTLED
 *                                          └─► FAILED
 */
export const TX_STATES = ["PROPOSED", "DENIED", "AWAITING_APPROVAL", "REJECTED", "AUTHORIZED", "EXECUTING", "SUBMITTED", "SETTLED", "SIMULATED", "FAILED"] as const;
export type TxState = (typeof TX_STATES)[number];

const ALLOWED: Record<TxState, TxState[]> = {
  PROPOSED: ["DENIED", "AWAITING_APPROVAL", "AUTHORIZED"],
  AWAITING_APPROVAL: ["AUTHORIZED", "REJECTED", "DENIED"],
  AUTHORIZED: ["EXECUTING", "DENIED"],
  EXECUTING: ["SUBMITTED", "SETTLED", "FAILED"],
  SUBMITTED: ["SETTLED", "FAILED"],
  DENIED: [],
  REJECTED: [],
  SETTLED: [],
  SIMULATED: [],
  FAILED: [],
};

export function canTransition(from: TxState, to: TxState): boolean {
  return ALLOWED[from].includes(to);
}

/** States whose amount counts as committed. Historical simulated rows are excluded. */
export const SPENT_STATES: TxState[] = ["EXECUTING", "SUBMITTED", "SETTLED", "AUTHORIZED"];
export const PENDING_STATES: TxState[] = ["AWAITING_APPROVAL"];

export async function transition(db: DB, txId: string, to: TxState, patch: Partial<typeof s.transactions.$inferInsert> = {}, note?: string): Promise<boolean> {
  return db.transaction(async (transaction) => {
  const db = transaction as unknown as DB;
  const [cur] = await db.select({ state: s.transactions.state }).from(s.transactions).where(eq(s.transactions.id, txId));
  if (!cur) throw new Error(`transaction ${txId} not found`);
  const from = cur.state as TxState;
  // Repeated completion callbacks and execution retries are no-ops. In particular, a worker
  // may never take ownership of an EXECUTING payment left by another worker.
  if (from === to || (to === "EXECUTING" && from !== "AUTHORIZED") || (["SETTLED", "FAILED"].includes(from) && ["SETTLED", "FAILED"].includes(to))) return false;
  if (!canTransition(from, to)) throw new Error(`illegal transition ${from} → ${to}`);
  // Conditional update: only succeeds if nobody else moved the row first.
  const updated = await db
    .update(s.transactions)
    .set({ ...patch, state: to, updatedAt: new Date() })
    .where(and(eq(s.transactions.id, txId), eq(s.transactions.state, from)))
    .returning({ id: s.transactions.id });
  if (!updated.length) return false;
  await db.insert(s.transactionEvents).values({ id: newId(), transactionId: txId, fromState: from, toState: to, note: note ?? null });
  return true;
  });
}

export async function createTransaction(db: DB, v: Omit<typeof s.transactions.$inferInsert, "id" | "state">): Promise<{ tx: typeof s.transactions.$inferSelect; duplicate: boolean }> {
  const existing = await db.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, v.idempotencyKey));
  if (existing.length) return { tx: existing[0], duplicate: true };
  const [tx] = await db
    .insert(s.transactions)
    .values({ ...v, id: newId(), state: "PROPOSED" })
    .onConflictDoNothing({ target: s.transactions.idempotencyKey })
    .returning();
  if (!tx) {
    const [again] = await db.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, v.idempotencyKey));
    return { tx: again, duplicate: true };
  }
  await db.insert(s.transactionEvents).values({ id: newId(), transactionId: tx.id, fromState: null, toState: "PROPOSED" });
  return { tx, duplicate: false };
}

/** Re-check the recorded authorization and current budget atomically immediately before signing. */
export async function claimExecution(db: DB, txId: string): Promise<{ claimed: boolean; state: string; message: string }> {
  return db.transaction(async (transaction) => {
    const db = transaction as unknown as DB;
    const [initial] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    if (!initial) throw new Error("transaction not found");
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${initial.projectId}`}))`);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    if (tx.state !== "AUTHORIZED") return { claimed: false, state: tx.state, message: "Already executing or resolved" };
    const [decision] = await db.select().from(s.agentDecisions).where(and(eq(s.agentDecisions.id, tx.decisionId), eq(s.agentDecisions.projectId, tx.projectId)));
    const parsed = parseFinancialAction(decision?.action);
    let reason = "The recorded action no longer matches its authorization";
    if (decision?.status === "approved" && parsed.success && parsed.data.action !== "reallocate_budget" && toMicro(parsed.data.amount) === tx.amountMicro && parsed.data.missionId === tx.missionId) {
      const action = parsed.data;
      const [approval] = await db.select().from(s.approvals).where(and(eq(s.approvals.transactionId, tx.id), eq(s.approvals.status, "approved"), eq(s.approvals.approvedMicro, tx.amountMicro)));
      const consent = action.action !== "send_payment" || (!!approval && !decision.autonomous);
      const state = await loadPolicyState(db, { projectId: tx.projectId, missionId: action.missionId, category: tx.budgetCategory, experimentId: action.action === "send_payment" ? action.experimentId : undefined, excludeTxId: tx.id, serviceKnown: true });
      const verdict = evaluatePolicy(action, await loadPolicy(db, tx.projectId), state, { founderApproved: !!approval && !decision.autonomous });
      let rewardError: string | null = null;
      if (action.action === "send_payment") {
        try { await assertCreatorReward(db, tx.projectId, action, tx.id); } catch (e) { rewardError = (e as Error).message; }
      }
      if (consent && verdict.verdict === "ALLOW" && !rewardError) {
        const claimed = await transition(db, txId, "EXECUTING", {}, "authorization and current budgets rechecked; execution lock acquired");
        return { claimed, state: claimed ? "EXECUTING" : tx.state, message: claimed ? "Execution authorized" : "Already executing" };
      }
      reason = rewardError ?? (!consent ? "This payment has no matching founder approval" : verdict.checks.filter((c) => !c.passed).map((c) => c.detail).join("; "));
    }
    await transition(db, tx.id, "DENIED", { error: reason }, reason);
    await updateDecision(db, tx.decisionId, { status: "denied", result: { state: "DENIED", reason } });
    if (tx.experimentId) await db.update(s.experiments).set({ status: (await experimentSpend(db, tx.experimentId)) > 0 ? "running" : "proposed", updatedAt: new Date() }).where(and(eq(s.experiments.id, tx.experimentId), eq(s.experiments.status, "awaiting_approval")));
    await writeReceipt(db, tx.decisionId);
    return { claimed: false, state: "DENIED", message: reason };
  });
}

async function sumMicro(db: DB, where: ReturnType<typeof and>): Promise<number> {
  const [r] = await db.select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}), 0)` }).from(s.transactions).where(where);
  return Number(r?.n ?? 0);
}

/** Bridges move funds between our own balances — they are not spend. */
const notTreasury = sql`${s.transactions.budgetCategory} <> 'treasury'`;

export async function spentToday(db: DB, projectId: string): Promise<number> {
  return sumMicro(db, and(eq(s.transactions.projectId, projectId), inArray(s.transactions.state, SPENT_STATES), gte(s.transactions.createdAt, startOfUtcDay()), notTreasury));
}

export async function missionSpend(db: DB, missionId: string): Promise<{ spent: number; pending: number }> {
  const spent = await sumMicro(db, and(eq(s.transactions.missionId, missionId), inArray(s.transactions.state, SPENT_STATES), notTreasury));
  const pending = await sumMicro(db, and(eq(s.transactions.missionId, missionId), inArray(s.transactions.state, PENDING_STATES), notTreasury));
  return { spent, pending };
}

export async function categorySpend(db: DB, missionId: string, category: string): Promise<number> {
  return sumMicro(db, and(eq(s.transactions.missionId, missionId), eq(s.transactions.budgetCategory, category), inArray(s.transactions.state, [...SPENT_STATES, ...PENDING_STATES])));
}

export async function experimentSpend(db: DB, experimentId: string): Promise<number> {
  return sumMicro(db, and(eq(s.transactions.experimentId, experimentId), inArray(s.transactions.state, SPENT_STATES), notTreasury));
}

export async function loadPolicy(db: DB, projectId: string): Promise<PolicyConfig> {
  const [p] = await db.select().from(s.policies).where(eq(s.policies.projectId, projectId));
  if (!p) throw new Error("No policy configured for project");
  return p;
}

/** Snapshot of everything the policy engine needs before a real payment. */
export async function loadPolicyState(db: DB, opts: { projectId: string; missionId: string; category: string; experimentId?: string; excludeTxId?: string; serviceKnown?: boolean; experimentRemainingMicro?: Record<string, number> }): Promise<PolicyState> {
  const [wallet] = await db.select().from(s.wallets).where(eq(s.wallets.projectId, opts.projectId));
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.id, opts.missionId), eq(s.missions.projectId, opts.projectId)));
  const [alloc] = await db.select().from(s.missionBudgets).where(and(eq(s.missionBudgets.missionId, opts.missionId), eq(s.missionBudgets.category, opts.category)));
  const configured = walletIsLive(wallet);
  const ms = await missionSpend(db, opts.missionId);
  // When re-evaluating an existing transaction (e.g. at approval), don't count it against itself.
  let self = 0;
  let selfSpentToday = 0;
  if (opts.excludeTxId) {
    const [t] = await db.select().from(s.transactions).where(and(eq(s.transactions.id, opts.excludeTxId), eq(s.transactions.projectId, opts.projectId), eq(s.transactions.missionId, opts.missionId), eq(s.transactions.budgetCategory, opts.category)));
    const st = t?.state as TxState | undefined;
    if (t && st && t.budgetCategory !== "treasury" && [...SPENT_STATES, ...PENDING_STATES].includes(st)) {
      self = t.amountMicro;
      if (SPENT_STATES.includes(st) && t.createdAt >= startOfUtcDay()) selfSpentToday = t.amountMicro;
    }
  }
  const [experiment] = opts.experimentId ? await db.select().from(s.experiments).where(and(eq(s.experiments.id, opts.experimentId), eq(s.experiments.projectId, opts.projectId), eq(s.experiments.missionId, opts.missionId))) : [];
  const committed = opts.experimentId ? await sumMicro(db, and(eq(s.transactions.experimentId, opts.experimentId), inArray(s.transactions.state, [...SPENT_STATES, ...PENDING_STATES, "PROPOSED"]), opts.excludeTxId ? sql`${s.transactions.id} <> ${opts.excludeTxId}` : undefined, notTreasury)) : 0;
  return {
    walletConfigured: configured,
    walletFrozen: wallet?.frozen ?? false,
    spentTodayMicro: (await spentToday(db, opts.projectId)) - selfSpentToday,
    missionBudgetMicro: mission?.budgetMicro ?? 0,
    missionCommittedMicro: ms.spent + ms.pending - self,
    missionActive: mission?.status === "active",
    categoryAllocatedMicro: alloc?.allocatedMicro ?? 0,
    categoryCommittedMicro: (await categorySpend(db, opts.missionId, opts.category)) - self,
    serviceKnown: opts.serviceKnown,
    experimentRemainingMicro: opts.experimentRemainingMicro,
    ...(opts.experimentId ? { experimentActive: !!experiment && ["proposed", "awaiting_approval", "running"].includes(experiment.status), experimentBudgetMicro: experiment?.budgetMicro ?? 0, experimentCommittedMicro: committed } : {}),
  };
}
