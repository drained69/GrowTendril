import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { fmtUsdc } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { pseudonym } from "@/server/security/secrets";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { campaignLedger } from "@/server/domain/growth/creator-campaigns";

/**
 * CUSTOMER VALUE — which campaigns bring customers who activate, buy and return, and whether
 * they are worth what the campaign cost.
 *
 * Built only from records the workspace already has: conversion events (first-party, signed),
 * referral attribution (deterministic, by code) and the payment ledger. Nothing is modelled.
 *
 *  - Customer: a `visitorId` the business sends with its events — its own stable customer ID.
 *  - Referred customer of campaign C: a customer whose EARLIEST referral-attributed event (other
 *    than a link visit) carries one of C's codes. First touch, so no customer counts twice.
 *    Later events from the same customer ID follow them, even when sent without the code.
 *  - Activated: did the chosen activation event at or after referral.
 *  - Paying: at least one purchase at or after referral. Revenue = recorded purchase values.
 *  - Repeat: a second purchase within the repeat window of the first. Only customers whose
 *    first purchase is at least one window old (or who already repeated) are in the denominator.
 *  - Costs: SETTLED ledger rows are confirmed spend; in-flight rows are pending. CPA and payback
 *    use confirmed spend only.
 *
 * A referral shows a customer used a campaign's link or code — not that the campaign caused the
 * purchase. Nothing here claims incremental sales.
 */

export const DEFAULT_ACTIVATION_EVENT: ConversionEventType = "signup";
export const DEFAULT_REPEAT_WINDOW_DAYS = 90;
/** Below these samples a recommendation is labelled early and never says "stop" on rates alone. */
export const MIN_REFERRED_FOR_JUDGEMENT = 20;
export const MIN_PAYING_FOR_COST = 5;
/** Under this share of referred customers activating, the funnel — not the channel — is the problem. */
export const LOW_ACTIVATION_RATE = 0.2;
/** Stop when matured cohorts have recovered less than this share of confirmed spend. */
export const STOP_RECOVERY_SHARE = 1 / 3;

/** Ledger states, split by what they mean for cost. */
export const CONFIRMED_TX_STATES = ["SETTLED"] as const;
export const PENDING_TX_STATES = ["PROPOSED", "AWAITING_APPROVAL", "AUTHORIZED", "EXECUTING", "SUBMITTED"] as const;
export const NOT_PAID_TX_STATES = ["DENIED", "REJECTED", "FAILED"] as const;

// ───────────────────────────── pure core ─────────────────────────────

export interface CvEvent {
  id: string;
  type: string;
  /** The business's own stable customer ID (`visitorId`), or null when it wasn't sent. */
  customerId: string | null;
  occurredAt: Date;
  valueMicro: number;
  /** Experiment the event is attributed to by referral code, if any. */
  experimentId: string | null;
  /** Tracking link (campaigns row) that carried the code, if any. */
  linkId: string | null;
  /** Order ID from metadata, used to collapse the same purchase sent twice. */
  orderKey: string | null;
}

export interface CohortSettings {
  activationEvent: string;
  repeatWindowDays: number;
}

const byTime = (a: CvEvent, b: CvEvent) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id);

/**
 * Collapse events the business sent more than once under different idempotency keys.
 * Purchases: same customer + same order ID, or (without an order ID) same customer, timestamp and
 * value. Other events: same customer, type and timestamp. Anonymous events are never merged —
 * two identical anonymous purchases may be two people.
 */
export function dedupeEvents(events: CvEvent[]): { events: CvEvent[]; duplicatesRemoved: number } {
  const seen = new Map<string, CvEvent>();
  const out: CvEvent[] = [];
  let dupes = 0;
  for (const e of [...events].sort(byTime)) {
    if (seen.has(`id:${e.id}`)) {
      dupes++;
      continue;
    }
    const key = !e.customerId
      ? `id:${e.id}`
      : e.type === "purchase"
        ? e.orderKey
          ? `p:${e.customerId}:o:${e.orderKey}`
          : `p:${e.customerId}:t:${e.occurredAt.getTime()}:${e.valueMicro}`
        : `e:${e.customerId}:${e.type}:${e.occurredAt.getTime()}`;
    const kept = seen.get(key);
    if (kept) {
      dupes++;
      // Keep the attribution if only the replay carried the referral code.
      if (!kept.experimentId && e.experimentId) Object.assign(kept, { experimentId: e.experimentId, linkId: e.linkId });
      continue;
    }
    const copy = { ...e };
    seen.set(key, copy);
    seen.set(`id:${e.id}`, copy);
    out.push(copy);
  }
  return { events: out, duplicatesRemoved: dupes };
}

export interface CustomerOutcome {
  customerId: string;
  experimentId: string;
  linkId: string | null;
  entryAt: Date;
  entryEventId: string;
  entryEventType: string;
  activatedAt: Date | null;
  purchases: { id: string; at: Date; valueMicro: number }[];
  revenueMicro: number;
  unvaluedPurchases: number;
  repeat: boolean;
  /** First purchase is at least one repeat window old, or the customer already repeated. */
  repeatEligible: boolean;
  /** Purchased before their first referral — an existing customer, not a new one. */
  purchasedBefore: boolean;
  /** Referral-attributed to more than one campaign; counted only for the first. */
  otherCampaigns: number;
}

/** One outcome per referred customer, assigned to the campaign of their first referral. */
export function buildOutcomes(raw: CvEvent[], settings: CohortSettings, now = Date.now()): CustomerOutcome[] {
  const events = [...raw].sort(byTime);
  const entries = new Map<string, { e: CvEvent; touched: Set<string> }>();
  for (const e of events) {
    if (!e.customerId || !e.experimentId || e.type === "visit") continue;
    const cur = entries.get(e.customerId);
    if (!cur) entries.set(e.customerId, { e, touched: new Set([e.experimentId]) });
    else cur.touched.add(e.experimentId);
  }
  const byCustomer = new Map<string, CvEvent[]>();
  for (const e of events) if (e.customerId && entries.has(e.customerId)) (byCustomer.get(e.customerId) ?? byCustomer.set(e.customerId, []).get(e.customerId)!).push(e);

  const windowMs = settings.repeatWindowDays * DAY_MS;
  const out: CustomerOutcome[] = [];
  for (const [customerId, { e: entry, touched }] of entries) {
    const mine = byCustomer.get(customerId) ?? [];
    const after = mine.filter((x) => x.occurredAt >= entry.occurredAt);
    const activation = after.find((x) => x.type === settings.activationEvent);
    const purchases = after.filter((x) => x.type === "purchase").map((x) => ({ id: x.id, at: x.occurredAt, valueMicro: x.valueMicro }));
    const first = purchases[0];
    const repeat = !!first && purchases.slice(1).some((p) => p.at.getTime() - first.at.getTime() <= windowMs);
    out.push({
      customerId,
      experimentId: entry.experimentId!,
      linkId: entry.linkId,
      entryAt: entry.occurredAt,
      entryEventId: entry.id,
      entryEventType: entry.type,
      activatedAt: activation?.occurredAt ?? null,
      purchases,
      revenueMicro: purchases.reduce((a, p) => a + Math.max(0, p.valueMicro), 0),
      unvaluedPurchases: purchases.filter((p) => p.valueMicro <= 0).length,
      repeat,
      repeatEligible: !!first && (repeat || now - first.at.getTime() >= windowMs),
      purchasedBefore: mine.some((x) => x.type === "purchase" && x.occurredAt < entry.occurredAt),
      otherCampaigns: touched.size - 1,
    });
  }
  return out;
}

export interface CohortSummary {
  referred: number;
  activated: number;
  paying: number;
  repeat: number;
  repeatEligible: number;
  purchases: number;
  valuedPurchases: number;
  unvaluedPurchases: number;
  revenueMicro: number;
  purchasedBefore: number;
  multiTouch: number;
  /** Distinct visitors on the campaign's links (browser cookie or sent ID). */
  linkVisitors: number;
  /** Attributed events (other than visits) sent without a customer ID — can't be followed. */
  unlinkedEvents: number;
}

export function summarize(outcomes: CustomerOutcome[], events: CvEvent[], experimentId: string, linkId?: string): CohortSummary {
  const mine = outcomes.filter((o) => o.experimentId === experimentId && (linkId === undefined || o.linkId === linkId));
  const attributed = events.filter((e) => e.experimentId === experimentId && (linkId === undefined || e.linkId === linkId));
  const visitors = new Set(attributed.filter((e) => e.type === "visit").map((e) => e.customerId ?? `event:${e.id}`));
  const purchases = mine.reduce((a, o) => a + o.purchases.length, 0);
  const unvalued = mine.reduce((a, o) => a + o.unvaluedPurchases, 0);
  return {
    referred: mine.length,
    activated: mine.filter((o) => o.activatedAt).length,
    paying: mine.filter((o) => o.purchases.length > 0).length,
    repeat: mine.filter((o) => o.repeat).length,
    repeatEligible: mine.filter((o) => o.repeatEligible).length,
    purchases,
    valuedPurchases: purchases - unvalued,
    unvaluedPurchases: unvalued,
    revenueMicro: mine.reduce((a, o) => a + o.revenueMicro, 0),
    purchasedBefore: mine.filter((o) => o.purchasedBefore).length,
    multiTouch: mine.filter((o) => o.otherCampaigns > 0).length,
    linkVisitors: visitors.size,
    unlinkedEvents: attributed.filter((e) => e.type !== "visit" && !e.customerId).length,
  };
}

export interface CostTx {
  state: string;
  amountMicro: number;
  budgetCategory: string;
  dataMode: string;
}

export interface CostBreakdown {
  /** Budget set aside for the campaign. Reserved, not spent. */
  budgetMicro: number;
  /** Settled payments — the only amount CPA and payback use. */
  confirmedMicro: number;
  /** Proposed, awaiting approval, authorized, executing or submitted but not yet confirmed. */
  pendingMicro: number;
  /** Creator rewards earned but not yet in any payment. */
  owedMicro: number;
  /** Simulated in a demo workspace — nothing moved. */
  simulatedMicro: number;
  /** Denied, rejected or failed — never paid. */
  notPaidMicro: number;
  /** Reservation not yet committed to anything above. */
  uncommittedMicro: number;
  /** Part of confirmed + pending that used test funds. */
  testFundsMicro: number;
}

const COMMITTED = new Set<string>([...CONFIRMED_TX_STATES, ...PENDING_TX_STATES]);

export function costBreakdown(budgetMicro: number, txs: CostTx[], owedMicro = 0): CostBreakdown {
  const sum = (states: readonly string[]) => txs.filter((t) => t.budgetCategory !== "treasury" && states.includes(t.state)).reduce((a, t) => a + t.amountMicro, 0);
  const confirmed = sum(CONFIRMED_TX_STATES);
  const pending = sum(PENDING_TX_STATES);
  const simulated = sum(["SIMULATED"]);
  return {
    budgetMicro,
    confirmedMicro: confirmed,
    pendingMicro: pending,
    owedMicro,
    simulatedMicro: simulated,
    notPaidMicro: sum(NOT_PAID_TX_STATES),
    uncommittedMicro: Math.max(0, budgetMicro - confirmed - pending - owedMicro - simulated),
    testFundsMicro: txs.filter((t) => t.budgetCategory !== "treasury" && t.dataMode === "TESTNET" && COMMITTED.has(t.state)).reduce((a, t) => a + t.amountMicro, 0),
  };
}

/** A number with its standing: recorded from data, estimated from an assumption, or not computable. */
export interface Metric {
  value: number | null;
  kind: "recorded" | "estimate" | "insufficient";
  detail: string;
}
const insufficient = (detail: string): Metric => ({ value: null, kind: "insufficient", detail });

export interface ValueMetrics {
  revenue: Metric;
  grossProfit: Metric;
  costPerPaying: Metric;
  /** Cost per paying customer if every pending payment settles. */
  costPerPayingWithPending: Metric;
  /** Recorded revenue ÷ confirmed spend. Revenue, not profit. */
  revenueMultiple: Metric;
  /** Estimated gross profit ÷ confirmed spend, and when it crossed 1 (if it did). */
  payback: Metric & { paidBackAt: Date | null };
}

export function valueMetrics(c: CohortSummary, cost: CostBreakdown, marginPct: number | null, outcomes: CustomerOutcome[] = []): ValueMetrics {
  const revenue: Metric =
    c.paying === 0
      ? insufficient("No referred customer has purchased yet")
      : c.valuedPurchases === 0
        ? insufficient(`${c.purchases} purchase${c.purchases === 1 ? "" : "s"} arrived without a value — send “value” with purchase events`)
        : { value: c.revenueMicro, kind: "recorded", detail: c.unvaluedPurchases ? `Partial: ${c.unvaluedPurchases} of ${c.purchases} purchases had no value and add nothing` : `Sum of ${c.purchases} recorded purchase value${c.purchases === 1 ? "" : "s"}` };
  const grossProfit: Metric =
    revenue.value == null ? insufficient(revenue.detail) : marginPct == null ? insufficient("Set a gross margin to estimate gross profit") : { value: Math.round((revenue.value * marginPct) / 100), kind: "estimate", detail: `Recorded revenue × your ${marginPct}% gross margin assumption` };

  const noSpend = cost.pendingMicro > 0 ? `No confirmed spend yet (${fmtUsdc(cost.pendingMicro)} pending)` : "No confirmed spend yet";
  const small = c.paying < MIN_PAYING_FOR_COST ? ` — small sample (${c.paying} paying)` : "";
  const costPerPaying: Metric = cost.confirmedMicro <= 0 ? insufficient(noSpend) : c.paying === 0 ? insufficient("No paying customers yet") : { value: Math.round(cost.confirmedMicro / c.paying), kind: "recorded", detail: `${fmtUsdc(cost.confirmedMicro)} confirmed ÷ ${c.paying} paying${small}` };
  const committed = cost.confirmedMicro + cost.pendingMicro;
  const costPerPayingWithPending: Metric = cost.pendingMicro <= 0 || c.paying === 0 ? insufficient(cost.pendingMicro <= 0 ? "No pending payments" : "No paying customers yet") : { value: Math.round(committed / c.paying), kind: "estimate", detail: `If ${fmtUsdc(cost.pendingMicro)} pending settles: ${fmtUsdc(committed)} ÷ ${c.paying} paying` };
  const revenueMultiple: Metric = revenue.value == null ? insufficient(revenue.detail) : cost.confirmedMicro <= 0 ? insufficient(noSpend) : { value: revenue.value / cost.confirmedMicro, kind: "recorded", detail: "Recorded revenue ÷ confirmed spend (revenue, not profit)" };

  let payback: ValueMetrics["payback"];
  if (grossProfit.value == null) payback = { ...insufficient(grossProfit.detail), paidBackAt: null };
  else if (cost.confirmedMicro <= 0) payback = { ...insufficient(noSpend), paidBackAt: null };
  else {
    // Walk recorded purchases in time order to find when estimated gross profit covered confirmed spend.
    const ps = outcomes.flatMap((o) => o.purchases).sort((a, b) => a.at.getTime() - b.at.getTime());
    let acc = 0;
    let paidBackAt: Date | null = null;
    for (const p of ps) {
      acc += (Math.max(0, p.valueMicro) * marginPct!) / 100;
      if (acc >= cost.confirmedMicro) {
        paidBackAt = p.at;
        break;
      }
    }
    const share = grossProfit.value / cost.confirmedMicro;
    payback = { value: share, kind: "estimate", detail: share >= 1 ? `Estimated gross profit ${fmtUsdc(grossProfit.value)} covers confirmed spend ${fmtUsdc(cost.confirmedMicro)}` : `Estimated gross profit has recovered ${Math.round(share * 100)}% of confirmed spend so far`, paidBackAt };
  }
  return { revenue, grossProfit, costPerPaying, costPerPayingWithPending, revenueMultiple, payback };
}

export type Verdict = "continue_testing" | "improve_funnel" | "stop_spending";
export const VERDICT_LABEL: Record<Verdict, string> = { continue_testing: "Continue testing", improve_funnel: "Improve the funnel", stop_spending: "Stop spending" };

export interface Recommendation {
  verdict: Verdict;
  /** "early" = below the minimum sample; treat as a direction, not a conclusion. */
  confidence: "early" | "measured";
  rule: string;
  reason: string;
  next: string;
}

/** The rules, in the order they are checked. The first that matches decides. */
export const RULES: { id: string; verdict: Verdict; when: string }[] = [
  { id: "no-signal", verdict: "continue_testing", when: "No referred customers and no spend yet" },
  { id: "spent-no-customers", verdict: "stop_spending", when: "Confirmed spend reached the campaign's own stop-after-spend threshold with zero referred customers" },
  { id: "small-sample", verdict: "continue_testing", when: `Fewer than ${MIN_REFERRED_FOR_JUDGEMENT} referred customers — too few to judge` },
  { id: "low-activation", verdict: "improve_funnel", when: `Under ${Math.round(LOW_ACTIVATION_RATE * 100)}% of referred customers activate` },
  { id: "no-purchases", verdict: "improve_funnel", when: "Customers activate but none have paid (stop spending instead once confirmed spend passes the stop threshold)" },
  { id: "few-payers", verdict: "continue_testing", when: `Fewer than ${MIN_PAYING_FOR_COST} paying customers — cost per customer is still noisy` },
  { id: "value-unknown", verdict: "continue_testing", when: "Purchase values, gross margin or confirmed spend missing — payback can't be judged" },
  { id: "paid-back", verdict: "continue_testing", when: "Estimated gross profit covers confirmed spend" },
  { id: "far-from-payback", verdict: "stop_spending", when: `Most paying customers are past the repeat window and gross profit has recovered under ${Math.round(STOP_RECOVERY_SHARE * 100)}% of confirmed spend` },
  { id: "recovering", verdict: "continue_testing", when: "Partly recovered; repeat purchases may still close the gap" },
];

export function recommend(c: CohortSummary, cost: CostBreakdown, v: ValueMetrics, opts: { stopAfterSpendMicro?: number; activationLabel: string }): Recommendation {
  const r = (rule: string, confidence: Recommendation["confidence"], reason: string, next: string, verdict?: Verdict): Recommendation => ({ verdict: verdict ?? RULES.find((x) => x.id === rule)!.verdict, confidence, rule, reason, next });
  const stopAt = opts.stopAfterSpendMicro ?? 0;
  const pastStop = stopAt > 0 && cost.confirmedMicro >= stopAt;
  const act = opts.activationLabel.toLowerCase();

  if (c.referred === 0 && cost.confirmedMicro === 0 && cost.pendingMicro === 0) return r("no-signal", "early", "No referred customers and no spend yet.", "Share the tracking link and make sure customer events reach GrowTendril.");
  if (c.referred === 0 && pastStop) return r("spent-no-customers", "measured", `${fmtUsdc(cost.confirmedMicro)} confirmed spend reached this campaign's stop threshold (${fmtUsdc(stopAt)}) with no referred customers.`, "Pause new spend. Check the link works and that your product sends events with the referral code.");
  if (c.referred < MIN_REFERRED_FOR_JUDGEMENT) return r("small-sample", "early", `${c.referred} referred customer${c.referred === 1 ? "" : "s"} so far — ${MIN_REFERRED_FOR_JUDGEMENT} needed before the numbers mean much.`, "Keep the test running at its current budget; don't scale on this sample.");
  const actRate = c.activated / c.referred;
  if (actRate < LOW_ACTIVATION_RATE) return r("low-activation", "measured", `Only ${Math.round(actRate * 100)}% of ${c.referred} referred customers reached “${act}”.`, "People arrive but don't get started. Fix the landing page or onboarding before buying more traffic.");
  if (c.paying === 0) {
    if (pastStop) return r("no-purchases", "measured", `${c.activated} activated, none paid, after ${fmtUsdc(cost.confirmedMicro)} confirmed spend (stop threshold ${fmtUsdc(stopAt)}).`, "Pause spend until the path from activation to purchase is fixed.", "stop_spending");
    return r("no-purchases", "measured", `${c.activated} of ${c.referred} activated, but none have paid.`, "Look at the step between activation and first purchase: pricing, checkout, trial end.");
  }
  if (c.paying < MIN_PAYING_FOR_COST) return r("few-payers", "early", `${c.paying} paying customer${c.paying === 1 ? "" : "s"} — ${MIN_PAYING_FOR_COST} needed before cost per customer is reliable.`, "Keep testing; watch cost per paying customer as more arrive.");
  if (v.payback.value == null) return r("value-unknown", "measured", `${c.paying} paying customers. ${v.payback.detail}.`, v.costPerPaying.value != null ? `Cost per paying customer is ${fmtUsdc(v.costPerPaying.value)} — compare it with what a customer is worth to you.` : "Payments must settle before cost per customer can be measured.");
  if (v.payback.value >= 1) return r("paid-back", "measured", `${v.payback.detail}.`, "Keep it running. Raise the budget in small steps and check that cost per paying customer holds.");
  const maturedShare = c.repeatEligible / c.paying;
  if (v.payback.value < STOP_RECOVERY_SHARE && maturedShare >= 0.5) return r("far-from-payback", "measured", `${Math.round(v.payback.value * 100)}% of confirmed spend recovered, and ${c.repeatEligible} of ${c.paying} paying customers are already past the repeat window.`, "Stop new spend here and move budget to a campaign that pays back.");
  return r("recovering", "measured", `${Math.round(v.payback.value * 100)}% of confirmed spend recovered; ${c.paying - c.repeatEligible} of ${c.paying} paying customers are still inside the repeat window.`, "Keep the budget flat until those customers mature, then re-check.");
}

/** What the business should connect next, most fundamental first. */
export interface Gap {
  key: string;
  title: string;
  detail: string;
  href: string;
}

// ───────────────────────────── loading ─────────────────────────────

export interface CohortConfig extends CohortSettings {
  saved: boolean;
  marginPct: number | null;
}

export async function getCohortConfig(db: DB, projectId: string): Promise<CohortConfig> {
  const [[row], [econ]] = await Promise.all([
    db.select().from(s.customerValueSettings).where(eq(s.customerValueSettings.projectId, projectId)),
    db.select({ marginPct: s.projectEconomics.grossMarginPct }).from(s.projectEconomics).where(eq(s.projectEconomics.projectId, projectId)),
  ]);
  return {
    activationEvent: row?.activationEvent ?? DEFAULT_ACTIVATION_EVENT,
    repeatWindowDays: row?.repeatWindowDays ?? DEFAULT_REPEAT_WINDOW_DAYS,
    saved: !!row,
    marginPct: econ?.marginPct ?? null,
  };
}

export interface CampaignRow {
  experimentId: string;
  name: string;
  kind: "creator" | "experiment";
  channel: string;
  status: string;
  creatorCampaignId: string | null;
  startsAt: Date | null;
  links: { id: string; name: string; code: string }[];
  cohort: CohortSummary;
  cost: CostBreakdown;
  value: ValueMetrics;
  recommendation: Recommendation;
}

export interface LedgerRow {
  id: string;
  experimentId: string;
  decisionId: string;
  kind: string;
  state: string;
  amountMicro: number;
  budgetCategory: string;
  txHash: string | null;
  explorerUrl: string | null;
  dataMode: string;
  createdAt: Date;
}

export interface CustomerValueReport {
  dataMode: "LIVE" | "DEMO";
  config: CohortConfig;
  rows: CampaignRow[];
  outcomes: CustomerOutcome[];
  events: CvEvent[];
  ledger: LedgerRow[];
  duplicatesRemoved: number;
  /** Experiments with no tracking link — they can't refer anyone, so they aren't compared. */
  untrackedExperiments: number;
  /** Project-wide counts per event type (same data mode), for setup guidance. */
  eventTypeCounts: Record<string, number>;
  purchasesWithoutCustomer: number;
  purchasesWithoutValue: number;
  gaps: Gap[];
}

const orderKeyOf = (m: Record<string, unknown> | null | undefined): string | null => {
  const v = m?.orderId ?? m?.order_id ?? m?.orderID;
  return typeof v === "string" || typeof v === "number" ? String(v).slice(0, 200) : null;
};

function chunks<T>(xs: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Everything the dashboard shows, for one workspace. Every query is scoped to `projectId`. */
export async function loadCustomerValue(db: DB, projectId: string, now = Date.now()): Promise<CustomerValueReport> {
  const [project] = await db.select({ dataMode: s.projects.dataMode }).from(s.projects).where(eq(s.projects.id, projectId));
  const dataMode: "LIVE" | "DEMO" = project?.dataMode === "DEMO" ? "DEMO" : "LIVE";
  // Demo events never mix into a live workspace's numbers.
  const modeFilter = dataMode === "DEMO" ? eq(s.conversionEvents.dataMode, "DEMO") : sql`${s.conversionEvents.dataMode} <> 'DEMO'`;
  const config = await getCohortConfig(db, projectId);

  const exps = await db.select().from(s.experiments).where(eq(s.experiments.projectId, projectId));
  const expIds = exps.map((x) => x.id);
  const [links, creators] = await Promise.all([
    expIds.length ? db.select({ id: s.campaigns.id, experimentId: s.campaigns.experimentId, name: s.campaigns.name, code: s.campaigns.referralCode }).from(s.campaigns).where(inArray(s.campaigns.experimentId, expIds)) : Promise.resolve([]),
    db.select().from(s.creatorCampaigns).where(eq(s.creatorCampaigns.projectId, projectId)),
  ]);
  const creatorByExp = new Map(creators.map((c) => [c.experimentId, c]));
  const tracked = exps.filter((x) => creatorByExp.has(x.id) || links.some((l) => l.experimentId === x.id));
  const trackedIds = tracked.map((x) => x.id);

  const eventCols = {
    id: s.conversionEvents.id,
    type: s.conversionEvents.eventType,
    customerId: s.conversionEvents.visitorId,
    occurredAt: s.conversionEvents.occurredAt,
    valueMicro: s.conversionEvents.valueMicro,
    metadata: s.conversionEvents.metadata,
    experimentId: s.attribution.experimentId,
    linkId: s.attribution.campaignId,
  };
  type Row = { id: string; type: string; customerId: string | null; occurredAt: Date; valueMicro: number; metadata: Record<string, unknown>; experimentId: string | null; linkId: string | null };
  const attributed: Row[] = trackedIds.length
    ? await db
        .select(eventCols)
        .from(s.conversionEvents)
        .innerJoin(s.attribution, eq(s.attribution.conversionEventId, s.conversionEvents.id))
        .where(and(eq(s.conversionEvents.projectId, projectId), inArray(s.attribution.experimentId, trackedIds), modeFilter))
    : [];
  // Follow referred customers into events they sent later, with or without a referral code.
  const customerIds = [...new Set(attributed.filter((e) => e.type !== "visit" && e.customerId).map((e) => e.customerId!))];
  const followUps: Row[] = [];
  for (const ids of chunks(customerIds)) {
    followUps.push(
      ...(await db
        .select(eventCols)
        .from(s.conversionEvents)
        .leftJoin(s.attribution, eq(s.attribution.conversionEventId, s.conversionEvents.id))
        .where(and(eq(s.conversionEvents.projectId, projectId), inArray(s.conversionEvents.visitorId, ids), modeFilter))),
    );
  }
  const trackedSet = new Set(trackedIds);
  const raw: CvEvent[] = [...new Map([...attributed, ...followUps].map((e) => [e.id, e])).values()].map((e) => ({
    id: e.id,
    type: e.type,
    customerId: e.customerId,
    occurredAt: e.occurredAt,
    valueMicro: Number(e.valueMicro ?? 0),
    // Attribution to an experiment of another workspace can't happen (codes are checked at ingest); ignore it defensively.
    experimentId: e.experimentId && trackedSet.has(e.experimentId) ? e.experimentId : null,
    linkId: e.experimentId && trackedSet.has(e.experimentId) ? e.linkId : null,
    orderKey: orderKeyOf(e.metadata),
  }));
  const { events, duplicatesRemoved } = dedupeEvents(raw);
  const outcomes = buildOutcomes(events, config, now);

  const [typeCounts, [anon], txs] = await Promise.all([
    db.select({ type: s.conversionEvents.eventType, n: sql<number>`count(*)::int` }).from(s.conversionEvents).where(and(eq(s.conversionEvents.projectId, projectId), modeFilter)).groupBy(s.conversionEvents.eventType),
    db
      .select({ noCustomer: sql<number>`count(*) filter (where ${s.conversionEvents.visitorId} is null)::int`, noValue: sql<number>`count(*) filter (where ${s.conversionEvents.valueMicro} <= 0)::int` })
      .from(s.conversionEvents)
      .where(and(eq(s.conversionEvents.projectId, projectId), eq(s.conversionEvents.eventType, "purchase"), modeFilter)),
    trackedIds.length
      ? db
          .select({ id: s.transactions.id, experimentId: s.transactions.experimentId, decisionId: s.transactions.decisionId, kind: s.transactions.kind, state: s.transactions.state, amountMicro: s.transactions.amountMicro, budgetCategory: s.transactions.budgetCategory, txHash: s.transactions.txHash, explorerUrl: s.transactions.explorerUrl, dataMode: s.transactions.dataMode, createdAt: s.transactions.createdAt })
          .from(s.transactions)
          .where(and(eq(s.transactions.projectId, projectId), inArray(s.transactions.experimentId, trackedIds)))
      : Promise.resolve([]),
  ]);
  const ledger: LedgerRow[] = txs.map((t) => ({ ...t, experimentId: t.experimentId!, amountMicro: Number(t.amountMicro) }));
  const eventTypeCounts = Object.fromEntries(typeCounts.map((r) => [r.type, r.n]));

  const activationLabel = EVENT_LABEL[config.activationEvent as ConversionEventType] ?? config.activationEvent;
  const rows: CampaignRow[] = [];
  for (const x of tracked) {
    const creator = creatorByExp.get(x.id) ?? null;
    let owed = 0;
    if (creator) {
      // Earned (incl. holdback) but not in any payment yet; rewards already in a payout are in the ledger rows.
      const l = await campaignLedger(db, creator);
      owed = l.verifiedMicro - l.inPayoutMicro;
    }
    const cohort = summarize(outcomes, events, x.id);
    const cost = costBreakdown(creator?.budgetMicro ?? x.budgetMicro, ledger.filter((t) => t.experimentId === x.id), owed);
    const value = valueMetrics(cohort, cost, config.marginPct, outcomes.filter((o) => o.experimentId === x.id));
    rows.push({
      experimentId: x.id,
      name: creator?.name ?? x.title,
      kind: creator ? "creator" : "experiment",
      channel: x.channel,
      status: creator ? creator.status : x.status,
      creatorCampaignId: creator?.id ?? null,
      startsAt: creator?.startsAt ?? x.startsAt ?? null,
      links: links.filter((l) => l.experimentId === x.id).map((l) => ({ id: l.id, name: l.name, code: l.code })),
      cohort,
      cost,
      value,
      recommendation: recommend(cohort, cost, value, { stopAfterSpendMicro: x.stopAfterSpendMicro, activationLabel }),
    });
  }
  rows.sort((a, b) => b.cohort.paying - a.cohort.paying || b.cohort.referred - a.cohort.referred || a.name.localeCompare(b.name));

  const report: Omit<CustomerValueReport, "gaps"> = {
    dataMode,
    config,
    rows,
    outcomes,
    events,
    ledger,
    duplicatesRemoved,
    untrackedExperiments: exps.length - tracked.length,
    eventTypeCounts,
    purchasesWithoutCustomer: anon?.noCustomer ?? 0,
    purchasesWithoutValue: anon?.noValue ?? 0,
  };
  return { ...report, gaps: setupGaps(report) };
}

/** The next integration step, derived from what has and hasn't arrived. Most fundamental first. */
export function setupGaps(r: Omit<CustomerValueReport, "gaps">): Gap[] {
  const gaps: Gap[] = [];
  const count = (t: string) => r.eventTypeCounts[t] ?? 0;
  const total = Object.values(r.eventTypeCounts).reduce((a, n) => a + n, 0);
  const act = EVENT_LABEL[r.config.activationEvent as ConversionEventType] ?? r.config.activationEvent;
  const attributedNonVisit = r.events.some((e) => e.experimentId && e.type !== "visit");
  if (!r.rows.length) gaps.push({ key: "no-campaigns", title: "No campaign with a tracking link yet", detail: "Create a creator campaign or launch an experiment. Each one gets referral links that tie customers back to it.", href: "/app/campaigns/new" });
  if (r.rows.length && total === 0) gaps.push({ key: "no-events", title: "No events received yet", detail: "Share a campaign's tracking link — visits are recorded automatically. Customer events come from your site or app via the signed events webhook.", href: "/app/integrations" });
  if (total > 0 && !attributedNonVisit) gaps.push({ key: "no-referred-events", title: "Visits arrive, but no customer events carry a referral code", detail: "When someone signs up, books or buys, send the event with the “ref” value from their landing URL (gos_ref) and your own customer ID as “visitorId”.", href: "/app/integrations" });
  if (attributedNonVisit && !r.outcomes.length) gaps.push({ key: "no-customer-id", title: "Referred events arrive without a customer ID", detail: "Send “visitorId” — your own stable customer or account ID — with every event, so later purchases can be linked to the campaign that referred the customer.", href: "/app/integrations" });
  if (r.outcomes.length && count(r.config.activationEvent) === 0) gaps.push({ key: "no-activation", title: `No “${act}” events received`, detail: "Send the event that means a customer got started, or choose a different activation event below.", href: "#definitions" });
  if (r.outcomes.length && count("purchase") === 0) gaps.push({ key: "no-purchases", title: "No purchase events received", detail: "Send a “purchase” event with the amount as “value” (and an order ID in metadata.orderId) each time a customer pays. Revenue, paying and repeat customers all come from these.", href: "/app/integrations" });
  if (count("purchase") > 0 && r.purchasesWithoutValue === count("purchase")) gaps.push({ key: "no-values", title: "Purchases arrive without a value", detail: "Revenue is only ever taken from recorded values. Add “value” to purchase events.", href: "/app/integrations" });
  else if (r.purchasesWithoutValue > 0) gaps.push({ key: "some-values", title: `${r.purchasesWithoutValue} purchase event${r.purchasesWithoutValue === 1 ? "" : "s"} without a value`, detail: "Those purchases count toward paying and repeat customers but add nothing to revenue, so revenue is understated.", href: "/app/integrations" });
  if (r.purchasesWithoutCustomer > 0) gaps.push({ key: "anon-purchases", title: `${r.purchasesWithoutCustomer} purchase event${r.purchasesWithoutCustomer === 1 ? "" : "s"} without a customer ID`, detail: "They can't be linked to any customer or campaign. Include “visitorId”.", href: "/app/integrations" });
  if (r.config.marginPct == null && r.outcomes.some((o) => o.revenueMicro > 0)) gaps.push({ key: "no-margin", title: "No gross margin set", detail: "Gross profit and payback are estimates from your margin. Without one, only recorded revenue is shown.", href: "#definitions" });
  return gaps;
}

/** Display alias for a customer ID: stable within the workspace, unlinkable outside it, never reversible. */
export function customerAlias(projectId: string, customerId: string): string {
  return `cus_${pseudonym(`customer:${projectId}`, customerId)}`;
}

