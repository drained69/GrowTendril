import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { startOfUtcDay } from "@/lib/time";
import { walletBalances, walletIsLive } from "@/server/integrations/circle/wallets";
import { ARC, IS_MAINNET } from "@/server/integrations/circle/config";
import type { PolicyConfig, PolicyState } from "@/server/domain/agent/policy";
import { notifyBudget, notifyTransaction } from "@/server/domain/notifications/webhooks";

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
 *                                          ├─► SIMULATED  (no wallet; nothing moved)
 *                                          └─► FAILED
 */
export const TX_STATES = ["PROPOSED", "DENIED", "AWAITING_APPROVAL", "REJECTED", "AUTHORIZED", "EXECUTING", "SUBMITTED", "SETTLED", "SIMULATED", "FAILED"] as const;
export type TxState = (typeof TX_STATES)[number];

const ALLOWED: Record<TxState, TxState[]> = {
  PROPOSED: ["DENIED", "AWAITING_APPROVAL", "AUTHORIZED"],
  AWAITING_APPROVAL: ["AUTHORIZED", "REJECTED", "DENIED"],
  AUTHORIZED: ["EXECUTING"],
  EXECUTING: ["SUBMITTED", "SETTLED", "SIMULATED", "FAILED"],
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

/** States whose amount counts as spent (money moved, is moving, or — in simulation — would have). */
export const SPENT_STATES: TxState[] = ["EXECUTING", "SUBMITTED", "SETTLED", "SIMULATED", "AUTHORIZED"];
export const PENDING_STATES: TxState[] = ["AWAITING_APPROVAL"];

export async function transition(db: DB, txId: string, to: TxState, patch: Partial<typeof s.transactions.$inferInsert> = {}, note?: string): Promise<boolean> {
  const [cur] = await db.select({ state: s.transactions.state }).from(s.transactions).where(eq(s.transactions.id, txId));
  if (!cur) throw new Error(`transaction ${txId} not found`);
  const from = cur.state as TxState;
  if (!canTransition(from, to)) throw new Error(`illegal transition ${from} → ${to}`);
  // Conditional update: only succeeds if nobody else moved the row first.
  const updated = await db
    .update(s.transactions)
    .set({ ...patch, state: to, updatedAt: new Date() })
    .where(and(eq(s.transactions.id, txId), eq(s.transactions.state, from)))
    .returning();
  if (!updated.length) return false;
  await db.insert(s.transactionEvents).values({ id: newId(), transactionId: txId, fromState: from, toState: to, note: note ?? null });
  await afterTransition(db, updated[0], to);
  return true;
}

/** Notifications for a committed transition. They never block or fail the transition itself. */
async function afterTransition(db: DB, tx: typeof s.transactions.$inferSelect, to: TxState) {
  try {
    if (to === "SETTLED" || to === "FAILED") await notifyTransaction(db, tx, to);
    if (to === "AUTHORIZED" && tx.missionId && tx.budgetCategory !== "treasury") {
      const [m] = await db.select({ name: s.missions.name, budgetMicro: s.missions.budgetMicro }).from(s.missions).where(eq(s.missions.id, tx.missionId));
      if (m) await notifyBudget(db, { projectId: tx.projectId, missionId: tx.missionId, missionName: m.name, budgetMicro: m.budgetMicro, spentMicro: (await missionSpend(db, tx.missionId)).spent });
    }
  } catch (e) {
    console.error("[growtendril webhooks]", (e as Error).message);
  }
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

/**
 * Snapshot of everything the policy engine needs. Simulation: a DEMO project without a
 * wallet may run the full decision path, but execution ends in SIMULATED — nothing moves.
 * Balances are read live (wallet USDC on Arc, Gateway available) unless `balances: false`;
 * a failed read is passed on as null so the policy can treat it as unknown.
 */
export async function loadPolicyState(
  db: DB,
  opts: { projectId: string; missionId: string; category: string; excludeTxId?: string; serviceKnown?: boolean; experimentRemainingMicro?: Record<string, number>; balances?: boolean; chain?: string },
): Promise<PolicyState & { simulation: boolean }> {
  const [wallet] = await db.select().from(s.wallets).where(eq(s.wallets.projectId, opts.projectId));
  const [mission] = await db.select().from(s.missions).where(eq(s.missions.id, opts.missionId));
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, opts.projectId));
  const [alloc] = await db.select().from(s.missionBudgets).where(and(eq(s.missionBudgets.missionId, opts.missionId), eq(s.missionBudgets.category, opts.category)));
  const configured = walletIsLive(wallet);
  const simulation = !configured && project?.dataMode === "DEMO";
  const ms = await missionSpend(db, opts.missionId);
  // When re-evaluating an existing transaction (e.g. at approval), don't count it against itself.
  let self = 0;
  let selfSpentToday = 0;
  if (opts.excludeTxId) {
    const [t] = await db.select().from(s.transactions).where(eq(s.transactions.id, opts.excludeTxId));
    const st = t?.state as TxState | undefined;
    if (t && st && t.budgetCategory !== "treasury" && [...SPENT_STATES, ...PENDING_STATES].includes(st)) {
      self = t.amountMicro;
      if (SPENT_STATES.includes(st) && t.createdAt >= startOfUtcDay()) selfSpentToday = t.amountMicro;
    }
  }
  let walletUsdcMicro: number | null | undefined;
  let gatewayAvailableMicro: number | null | undefined;
  if (configured && opts.balances !== false) {
    const b = await walletBalances(wallet ?? null);
    // Only the Arc balance is read; a send or bridge from another chain has an unknown source balance.
    walletUsdcMicro = !opts.chain || opts.chain === ARC.appKitChain ? b.walletMicro : null;
    gatewayAvailableMicro = b.gatewayMicro;
  }
  return {
    walletConfigured: configured || simulation,
    walletFrozen: wallet?.frozen ?? false,
    spentTodayMicro: (await spentToday(db, opts.projectId)) - selfSpentToday,
    missionBudgetMicro: mission?.budgetMicro ?? 0,
    missionCommittedMicro: ms.spent + ms.pending - self,
    missionActive: mission?.status === "active",
    categoryAllocatedMicro: alloc?.allocatedMicro ?? 0,
    categoryCommittedMicro: (await categorySpend(db, opts.missionId, opts.category)) - self,
    serviceKnown: opts.serviceKnown,
    experimentRemainingMicro: opts.experimentRemainingMicro,
    simulation,
    walletUsdcMicro,
    gatewayAvailableMicro,
    mainnet: IS_MAINNET,
  };
}
