import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { fmtUsdc } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import type { PlanRules } from "@/server/domain/growth/campaign-plan";

/**
 * Campaign economics with provenance. Every figure is one of:
 *  - measured:  computed from this project's own events or ledger (sample size shown)
 *  - setting:   saved by the project in Settings → Economics
 *  - starting:  a starting value the project hasn't reviewed yet (labelled as such)
 *  - unavailable: no data and no setting — never filled with a guess
 */
export type Source = "measured" | "setting" | "starting" | "unavailable";
export interface Figure {
  value: number | null;
  source: Source;
  detail: string;
}

export type Economics = typeof s.projectEconomics.$inferSelect;

export const MEASURE_WINDOW_DAYS = 90;
/** Below these sample sizes a measured rate is too noisy to price money on. */
export const MIN_ACTIONS_FOR_RATE = 30;
export const MIN_PURCHASES_FOR_VALUE = 10;
export const MIN_ACTIONS_FOR_CPA = 10;

export const STARTING: Omit<Economics, "projectId" | "updatedBy" | "updatedAt"> = {
  customerValueMicro: null,
  grossMarginPct: null,
  acquisitionSharePct: 30,
  conversionRateBps: null,
  fixedPaySharePct: 25,
  actionBonusSharePct: 80,
  minActionsPerCreator: 3,
  maxCreators: 10,
  testPhaseSharePct: 50,
  holdbackDays: 7,
};

export async function getEconomics(db: DB, projectId: string): Promise<{ row: Economics | null; values: typeof STARTING; saved: boolean }> {
  const [row] = await db.select().from(s.projectEconomics).where(eq(s.projectEconomics.projectId, projectId));
  return { row: row ?? null, values: row ? { ...STARTING, ...row } : STARTING, saved: !!row };
}

export function planRules(values: typeof STARTING): PlanRules {
  return {
    fixedPayShare: values.fixedPaySharePct / 100,
    actionBonusShare: values.actionBonusSharePct / 100,
    minActionsPerCreator: values.minActionsPerCreator,
    maxCreators: values.maxCreators,
    testPhaseShare: values.testPhaseSharePct / 100,
    holdbackDays: values.holdbackDays,
  };
}

export interface Measured {
  windowDays: number;
  dataMode: "LIVE" | "DEMO";
  actions: number;
  customers: number;
  purchases: number;
  conversionRate: Figure;
  avgCustomerValue: Figure;
  campaignCostPerAction: Figure;
}

/** What the project's own data says, for one target action. */
export async function measureEconomics(db: DB, projectId: string, targetEvent: ConversionEventType, now = Date.now()): Promise<Measured> {
  const [project] = await db.select({ dataMode: s.projects.dataMode }).from(s.projects).where(eq(s.projects.id, projectId));
  const mode = project?.dataMode === "DEMO" ? "DEMO" : "LIVE";
  const since = new Date(now - MEASURE_WINDOW_DAYS * DAY_MS);
  const modeFilter = mode === "DEMO" ? eq(s.conversionEvents.dataMode, "DEMO") : sql`${s.conversionEvents.dataMode} <> 'DEMO'`;
  const events = await db
    .select({ type: s.conversionEvents.eventType, visitor: s.conversionEvents.visitorId, at: s.conversionEvents.occurredAt, value: s.conversionEvents.valueMicro, id: s.conversionEvents.id })
    .from(s.conversionEvents)
    .where(and(eq(s.conversionEvents.projectId, projectId), gte(s.conversionEvents.occurredAt, since), inArray(s.conversionEvents.eventType, [targetEvent, "purchase"]), modeFilter));

  // Actions are counted once per visitor; a customer is a visitor who purchased after their action.
  const firstAction = new Map<string, Date>();
  let anonymousActions = 0;
  for (const e of events) {
    if (e.type !== targetEvent) continue;
    if (!e.visitor) anonymousActions++;
    else if (!firstAction.has(e.visitor) || e.at < firstAction.get(e.visitor)!) firstAction.set(e.visitor, e.at);
  }
  const buyers = new Set<string>();
  const purchases = events.filter((e) => e.type === "purchase");
  for (const p of purchases) if (p.visitor && firstAction.has(p.visitor) && p.at >= firstAction.get(p.visitor)!) buyers.add(p.visitor);
  const linkedActions = firstAction.size;
  const label = EVENT_LABEL[targetEvent]?.toLowerCase() ?? targetEvent;

  const conversionRate: Figure =
    targetEvent === "purchase"
      ? { value: 1, source: "measured", detail: "The target action is the purchase itself" }
      : linkedActions >= MIN_ACTIONS_FOR_RATE
        ? { value: buyers.size / linkedActions, source: "measured", detail: `${buyers.size} of ${linkedActions} visitors who did “${label}” later purchased (last ${MEASURE_WINDOW_DAYS} days)` }
        : { value: null, source: "unavailable", detail: `Needs ${MIN_ACTIONS_FOR_RATE}+ “${label}” events with a visitor ID; ${linkedActions} so far${anonymousActions ? ` (${anonymousActions} without visitor ID can't be linked)` : ""}` };

  const valued = purchases.filter((p) => p.value > 0);
  const avgCustomerValue: Figure =
    valued.length >= MIN_PURCHASES_FOR_VALUE
      ? { value: Math.round(valued.reduce((a, p) => a + p.value, 0) / valued.length), source: "measured", detail: `Average of ${valued.length} purchase events with a value (last ${MEASURE_WINDOW_DAYS} days)` }
      : { value: null, source: "unavailable", detail: `Needs ${MIN_PURCHASES_FOR_VALUE}+ purchase events sent with a value; ${valued.length} so far` };

  // What past creator campaigns actually cost per verified action (all reward lines ÷ verified actions).
  const past = await db
    .select({ amount: sql<number>`coalesce(sum(${s.campaignRewards.amountMicro}), 0)::bigint`, actions: sql<number>`count(*) filter (where ${s.campaignRewards.kind} = 'action')::int` })
    .from(s.campaignRewards)
    .innerJoin(s.creatorCampaigns, eq(s.campaignRewards.campaignId, s.creatorCampaigns.id))
    .where(and(eq(s.creatorCampaigns.projectId, projectId), eq(s.creatorCampaigns.targetEvent, targetEvent), isNull(s.campaignRewards.voidedAt)));
  const spent = Number(past[0]?.amount ?? 0);
  const verified = Number(past[0]?.actions ?? 0);
  const campaignCostPerAction: Figure =
    verified >= MIN_ACTIONS_FOR_CPA
      ? { value: Math.round(spent / verified), source: "measured", detail: `${fmtUsdc(spent)} earned by creators ÷ ${verified} verified actions in past campaigns` }
      : { value: null, source: "unavailable", detail: `Needs ${MIN_ACTIONS_FOR_CPA}+ verified actions from past campaigns; ${verified} so far` };

  return { windowDays: MEASURE_WINDOW_DAYS, dataMode: mode, actions: linkedActions + anonymousActions, customers: buyers.size, purchases: purchases.length, conversionRate, avgCustomerValue, campaignCostPerAction };
}

export interface CeilingSuggestion {
  maxCostPerActionMicro: number | null;
  inputs: { key: string; label: string; figure: Figure }[];
  explanation: string;
}

/**
 * The most an action is worth: customer value × gross margin × share of actions that become customers
 * × the share of margin the business will spend to acquire. Missing inputs produce no suggestion.
 */
export function suggestCeiling(econ: { values: typeof STARTING; saved: boolean }, m: Measured): CeilingSuggestion {
  const v = econ.values;
  const value: Figure = v.customerValueMicro != null ? { value: v.customerValueMicro, source: "setting", detail: "Customer value saved in Settings → Economics" } : m.avgCustomerValue;
  const margin: Figure = v.grossMarginPct != null ? { value: v.grossMarginPct / 100, source: "setting", detail: "Gross margin saved in Settings → Economics" } : { value: null, source: "unavailable", detail: "Gross margin can't be measured from events — set it in Settings → Economics" };
  const rate: Figure = m.conversionRate.value != null ? m.conversionRate : v.conversionRateBps != null ? { value: v.conversionRateBps / 10_000, source: "setting", detail: `Saved estimate — replaced automatically once ${MIN_ACTIONS_FOR_RATE}+ linked actions are measured` } : m.conversionRate;
  const share: Figure = { value: v.acquisitionSharePct / 100, source: econ.saved ? "setting" : "starting", detail: econ.saved ? "Acquisition share saved in Settings → Economics" : "Starting value — review it in Settings → Economics" };
  const inputs = [
    { key: "value", label: "Customer value", figure: value },
    { key: "margin", label: "Gross margin", figure: margin },
    { key: "rate", label: "Action → customer rate", figure: rate },
    { key: "share", label: "Share of margin spent on acquisition", figure: share },
  ];
  const missing = inputs.filter((i) => i.figure.value == null);
  if (missing.length) return { maxCostPerActionMicro: null, inputs, explanation: `No suggestion yet — missing ${missing.map((i) => i.label.toLowerCase()).join(", ")}. Enter your own ceiling or add the missing figures.` };
  const micro = Math.floor((value.value! * margin.value! * rate.value! * share.value!) / 10_000) * 10_000;
  return { maxCostPerActionMicro: micro, inputs, explanation: `${fmtUsdc(value.value!)} × ${Math.round(margin.value! * 100)}% margin × ${(rate.value! * 100).toFixed(1)}% become customers × ${Math.round(share.value! * 100)}% spend share = ${fmtUsdc(micro)} per action` };
}
