import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Real traction counters across the deployment. Anything belonging to a DEMO project is
 * excluded (unless includeDemo), and money counts only TESTNET/LIVE rows that reached Circle.
 */
export async function tractionMetrics(db: DB, opts: { includeDemo?: boolean } = {}) {
  const all = (await db.select({ id: s.projects.id, mode: s.projects.dataMode, step: s.projects.onboardingStep, lastCycleAt: s.projects.lastCycleAt }).from(s.projects)).filter((p) => opts.includeDemo || p.mode !== "DEMO");
  const ids = all.map((p) => p.id);
  // A "live workspace" finished onboarding and has run at least one operator cycle.
  const live = all.filter((p) => p.step >= 5 && p.lastCycleAt != null).length;
  const zero = { projects: 0, opportunities: 0, qualified: 0, kols: 0, experiments: 0, spentMicro: 0, x402: 0, arcTx: 0, conversions: 0, costPerConversion: null as number | null, decisions: 0, autonomous: 0, approvals: 0 };
  if (!ids.length) return zero;
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const c = sql<number>`count(*)::int`;
  const realTx = and(inArray(s.transactions.projectId, ids), inArray(s.transactions.state, ["SUBMITTED", "SETTLED"]), inArray(s.transactions.dataMode, ["TESTNET", "LIVE"]));
  const [spent] = await db.select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}),0)` }).from(s.transactions).where(and(realTx, sql`${s.transactions.budgetCategory} <> 'treasury'`));
  const conversions = await n(db.select({ n: c }).from(s.attribution).innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id)).where(inArray(s.conversionEvents.projectId, ids)));
  const spentMicro = Number(spent?.n ?? 0);
  return {
    projects: live,
    opportunities: await n(db.select({ n: c }).from(s.opportunities).where(inArray(s.opportunities.projectId, ids))),
    qualified: await n(db.select({ n: c }).from(s.companies).where(and(inArray(s.companies.projectId, ids), eq(s.companies.status, "qualified")))),
    kols: await n(db.select({ n: c }).from(s.kols).where(inArray(s.kols.projectId, ids))),
    experiments: await n(db.select({ n: c }).from(s.experiments).where(inArray(s.experiments.projectId, ids))),
    spentMicro,
    x402: await n(db.select({ n: c }).from(s.transactions).where(and(realTx, eq(s.transactions.rail, "gateway_x402")))),
    // Gateway deposits are on-chain transfers into the Gateway contract, so they count as Arc txs.
    arcTx: await n(db.select({ n: c }).from(s.transactions).where(and(realTx, inArray(s.transactions.rail, ["app_kit_send", "app_kit_bridge", "gateway_deposit"])))),
    conversions,
    costPerConversion: conversions && spentMicro ? spentMicro / conversions : null,
    decisions: await n(db.select({ n: c }).from(s.agentDecisions).where(inArray(s.agentDecisions.projectId, ids))),
    autonomous: await n(db.select({ n: c }).from(s.agentDecisions).where(and(inArray(s.agentDecisions.projectId, ids), eq(s.agentDecisions.autonomous, true)))),
    approvals: await n(db.select({ n: c }).from(s.approvals).where(and(inArray(s.approvals.projectId, ids), sql`${s.approvals.status} <> 'pending'`))),
  };
}

