import { describe, it, expect, beforeAll } from "vitest";
import type { DB } from "@/server/db/client";
import { toMicro } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { buildOutcomes, costBreakdown, dedupeEvents, recommend, summarize, valueMetrics, MIN_REFERRED_FOR_JUDGEMENT, type CohortSummary, type CostBreakdown, type CvEvent } from "@/server/domain/growth/customer-value";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "33".repeat(32);

const NOW = Date.parse("2026-06-01T00:00:00Z");
const at = (daysAgo: number, hour = 0) => new Date(NOW - daysAgo * DAY_MS + hour * 3_600_000);
let n = 0;
const ev = (p: Partial<CvEvent> & { type: string }): CvEvent => ({ id: `e${++n}`, customerId: null, occurredAt: at(10), valueMicro: 0, experimentId: null, linkId: null, orderKey: null, ...p });
const SETTINGS = { activationEvent: "signup", repeatWindowDays: 30 };
const noCost = (over: Partial<CostBreakdown> = {}): CostBreakdown => ({ ...costBreakdown(0, []), ...over });

describe("deduplication", () => {
  it("collapses a purchase resent with a new idempotency key", () => {
    const { events, duplicatesRemoved } = dedupeEvents([
      ev({ type: "purchase", customerId: "c1", orderKey: "o-1", valueMicro: toMicro(50), occurredAt: at(5) }),
      ev({ type: "purchase", customerId: "c1", orderKey: "o-1", valueMicro: toMicro(50), occurredAt: at(5, 1) }), // same order, retried an hour later
      ev({ type: "purchase", customerId: "c1", orderKey: "o-2", valueMicro: toMicro(50), occurredAt: at(5) }), // different order, same time and value
    ]);
    expect(events.filter((e) => e.type === "purchase").map((e) => e.orderKey)).toEqual(["o-1", "o-2"]);
    expect(duplicatesRemoved).toBe(1);
  });

  it("without an order ID, collapses only exact same-customer replays — never anonymous events", () => {
    const { events, duplicatesRemoved } = dedupeEvents([
      ev({ type: "purchase", customerId: "c1", valueMicro: toMicro(20), occurredAt: at(3) }),
      ev({ type: "purchase", customerId: "c1", valueMicro: toMicro(20), occurredAt: at(3) }),
      ev({ type: "purchase", customerId: "c1", valueMicro: toMicro(25), occurredAt: at(3) }), // different amount → a real second purchase
      ev({ type: "purchase", valueMicro: toMicro(20), occurredAt: at(3) }), // two anonymous buyers could be two people
      ev({ type: "purchase", valueMicro: toMicro(20), occurredAt: at(3) }),
      ev({ type: "signup", customerId: "c1", occurredAt: at(4) }),
      ev({ type: "signup", customerId: "c1", occurredAt: at(4) }),
    ]);
    expect(duplicatesRemoved).toBe(2);
    expect(events.filter((e) => e.type === "purchase")).toHaveLength(4);
  });

  it("keeps the referral code when only the replay carried it", () => {
    const { events } = dedupeEvents([ev({ type: "signup", customerId: "c1", occurredAt: at(4) }), ev({ type: "signup", customerId: "c1", occurredAt: at(4), experimentId: "x1", linkId: "l1" })]);
    expect(events).toHaveLength(1);
    expect(events[0].experimentId).toBe("x1");
  });

  it("counts each referred customer once, however many events they send", () => {
    const events = [ev({ type: "signup", customerId: "c1", experimentId: "x1", occurredAt: at(9) }), ev({ type: "signup", customerId: "c1", experimentId: "x1", occurredAt: at(8) }), ev({ type: "trial_start", customerId: "c1", experimentId: "x1", occurredAt: at(7) })];
    const s = summarize(buildOutcomes(events, SETTINGS, NOW), events, "x1");
    expect(s.referred).toBe(1);
  });
});

describe("cohorts", () => {
  it("assigns a customer to the campaign of their first referral only", () => {
    const events = [ev({ type: "signup", customerId: "c1", experimentId: "A", occurredAt: at(20) }), ev({ type: "purchase", customerId: "c1", experimentId: "B", occurredAt: at(10), valueMicro: toMicro(40) })];
    const outcomes = buildOutcomes(events, SETTINGS, NOW);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ experimentId: "A", otherCampaigns: 1, revenueMicro: toMicro(40) });
    expect(summarize(outcomes, events, "B").referred).toBe(0);
  });

  it("follows a customer into later purchases sent without a referral code", () => {
    const events = [ev({ type: "signup", customerId: "c1", experimentId: "A", occurredAt: at(20) }), ev({ type: "purchase", customerId: "c1", occurredAt: at(5), valueMicro: toMicro(30) })];
    expect(summarize(buildOutcomes(events, SETTINGS, NOW), events, "A")).toMatchObject({ paying: 1, revenueMicro: toMicro(30) });
  });

  it("ignores link visits when deciding who was referred, but counts their visitors", () => {
    const events = [ev({ type: "visit", customerId: "cookie-1", experimentId: "A" }), ev({ type: "visit", experimentId: "A" })];
    expect(summarize(buildOutcomes(events, SETTINGS, NOW), events, "A")).toMatchObject({ referred: 0, linkVisitors: 2 });
  });

  it("does not count purchases from before the referral, and flags existing customers", () => {
    const events = [ev({ type: "purchase", customerId: "c1", occurredAt: at(40), valueMicro: toMicro(99) }), ev({ type: "signup", customerId: "c1", experimentId: "A", occurredAt: at(20) })];
    const [o] = buildOutcomes(events, SETTINGS, NOW);
    expect(o).toMatchObject({ purchasedBefore: true, revenueMicro: 0 });
    expect(o.purchases).toHaveLength(0);
  });

  it("counts activation only at or after referral, for the chosen event", () => {
    const events = [
      ev({ type: "sdk_install", customerId: "c1", occurredAt: at(30) }), // before referral
      ev({ type: "signup", customerId: "c1", experimentId: "A", occurredAt: at(20) }),
      ev({ type: "signup", customerId: "c2", experimentId: "A", occurredAt: at(20) }),
      ev({ type: "sdk_install", customerId: "c2", occurredAt: at(19) }),
    ];
    expect(summarize(buildOutcomes(events, SETTINGS, NOW), events, "A").activated).toBe(2); // the referral signup is itself the activation
    expect(summarize(buildOutcomes(events, { ...SETTINGS, activationEvent: "sdk_install" }, NOW), events, "A").activated).toBe(1);
  });

  it("applies the repeat window and only judges customers whose window has closed", () => {
    const signup = (c: string, d: number) => ev({ type: "signup", customerId: c, experimentId: "A", occurredAt: at(d) });
    const buy = (c: string, d: number) => ev({ type: "purchase", customerId: c, occurredAt: at(d), valueMicro: toMicro(10) });
    const events = [
      signup("in", 100), buy("in", 90), buy("in", 70), // 2nd purchase 20 days after 1st → repeat
      signup("late", 100), buy("late", 90), buy("late", 50), // 40 days later → outside a 30-day window
      signup("open", 20), buy("open", 10), // window still open, no repeat yet → not judged
      signup("fast", 20), buy("fast", 10), buy("fast", 5), // already repeated inside an open window → judged
    ];
    const s = summarize(buildOutcomes(events, SETTINGS, NOW), events, "A");
    expect(s).toMatchObject({ paying: 4, repeat: 2, repeatEligible: 3 });
    // A longer window turns "late" into a repeat customer and leaves "open" un-judged.
    const wide = summarize(buildOutcomes(events, { ...SETTINGS, repeatWindowDays: 60 }, NOW), events, "A");
    expect(wide).toMatchObject({ repeat: 3, repeatEligible: 3 });
  });
});

describe("missing data", () => {
  const base = summarize([], [], "A");
  const withPayers = (over: Partial<CohortSummary>): CohortSummary => ({ ...base, referred: 30, activated: 20, paying: 6, purchases: 6, valuedPurchases: 6, revenueMicro: toMicro(600), ...over });

  it("never invents revenue: no purchases, or purchases without values, are insufficient data", () => {
    expect(valueMetrics(base, noCost(), 50).revenue).toMatchObject({ value: null, kind: "insufficient" });
    const v = valueMetrics(withPayers({ valuedPurchases: 0, revenueMicro: 0 }), noCost({ confirmedMicro: toMicro(100) }), 50);
    expect(v.revenue.value).toBeNull();
    expect(v.revenue.detail).toMatch(/without a value/);
    expect(v.payback.value).toBeNull();
  });

  it("labels partial revenue when some purchases lack a value", () => {
    const v = valueMetrics(withPayers({ purchases: 8, unvaluedPurchases: 2 }), noCost(), null);
    expect(v.revenue).toMatchObject({ value: toMicro(600), kind: "recorded" });
    expect(v.revenue.detail).toMatch(/Partial: 2 of 8/);
  });

  it("estimates gross profit and payback only with a margin assumption", () => {
    const cost = noCost({ confirmedMicro: toMicro(300) });
    const none = valueMetrics(withPayers({}), cost, null);
    expect(none.grossProfit.value).toBeNull();
    expect(none.payback.value).toBeNull();
    expect(none.revenueMultiple).toMatchObject({ value: 2, kind: "recorded" });
    const est = valueMetrics(withPayers({}), cost, 40);
    expect(est.grossProfit).toMatchObject({ value: toMicro(240), kind: "estimate" });
    expect(est.payback).toMatchObject({ value: 0.8, kind: "estimate", paidBackAt: null });
  });

  it("finds the date estimated gross profit covered confirmed spend", () => {
    const events = [ev({ type: "signup", customerId: "c1", experimentId: "A", occurredAt: at(50) }), ev({ type: "purchase", customerId: "c1", occurredAt: at(40), valueMicro: toMicro(100) }), ev({ type: "purchase", customerId: "c1", occurredAt: at(20), valueMicro: toMicro(100) })];
    const outcomes = buildOutcomes(events, SETTINGS, NOW);
    const v = valueMetrics(summarize(outcomes, events, "A"), noCost({ confirmedMicro: toMicro(80) }), 50, outcomes);
    expect(v.payback.value).toBeCloseTo(1.25);
    expect(v.payback.paidBackAt?.getTime()).toBe(at(20).getTime()); // 50 after the first purchase, 100 after the second
  });
});

describe("costs", () => {
  const tx = (state: string, usdc: number, extra: { budgetCategory?: string; dataMode?: string } = {}) => ({ state, amountMicro: toMicro(usdc), budgetCategory: extra.budgetCategory ?? "kol", dataMode: extra.dataMode ?? "LIVE" });

  it("separates reserved budget, pending payments and confirmed spend", () => {
    const c = costBreakdown(
      toMicro(500),
      [tx("SETTLED", 100), tx("SETTLED", 20, { dataMode: "TESTNET" }), tx("SUBMITTED", 30), tx("AWAITING_APPROVAL", 40), tx("AUTHORIZED", 5), tx("FAILED", 60), tx("REJECTED", 10), tx("SIMULATED", 7), tx("SETTLED", 1000, { budgetCategory: "treasury" })],
      toMicro(15),
    );
    expect(c).toMatchObject({
      budgetMicro: toMicro(500),
      confirmedMicro: toMicro(120),
      pendingMicro: toMicro(75), // submitted + awaiting approval + authorized: not confirmed yet
      notPaidMicro: toMicro(70),
      simulatedMicro: toMicro(7),
      owedMicro: toMicro(15),
      uncommittedMicro: toMicro(500 - 120 - 75 - 15 - 7),
      testFundsMicro: toMicro(20),
    });
  });

  it("uses confirmed spend for cost per paying customer, never pending", () => {
    const s: CohortSummary = { ...summarize([], [], "A"), referred: 25, activated: 20, paying: 4, purchases: 4, valuedPurchases: 4, revenueMicro: toMicro(400) };
    const v = valueMetrics(s, noCost({ confirmedMicro: toMicro(200), pendingMicro: toMicro(100) }), null);
    expect(v.costPerPaying.value).toBe(toMicro(50));
    expect(v.costPerPaying.detail).toMatch(/small sample/);
    expect(v.costPerPayingWithPending).toMatchObject({ value: toMicro(75), kind: "estimate" });
    const pendingOnly = valueMetrics(s, noCost({ pendingMicro: toMicro(100) }), null);
    expect(pendingOnly.costPerPaying.value).toBeNull();
    expect(pendingOnly.costPerPaying.detail).toMatch(/No confirmed spend yet .*pending/);
  });
});

describe("recommendations", () => {
  const base = summarize([], [], "A");
  const rec = (c: Partial<CohortSummary>, cost: Partial<CostBreakdown> = {}, margin: number | null = 50, stop = toMicro(100)) => {
    const cohort = { ...base, ...c };
    const k = noCost(cost);
    return recommend(cohort, k, valueMetrics(cohort, k, margin), { stopAfterSpendMicro: stop, activationLabel: "Signup" });
  };

  it("refuses to judge small samples", () => {
    expect(rec({})).toMatchObject({ verdict: "continue_testing", rule: "no-signal", confidence: "early" });
    expect(rec({ referred: MIN_REFERRED_FOR_JUDGEMENT - 1, activated: 0 }, { confirmedMicro: toMicro(50) })).toMatchObject({ verdict: "continue_testing", rule: "small-sample", confidence: "early" });
    expect(rec({ referred: 30, activated: 20, paying: 2, purchases: 2, valuedPurchases: 2, revenueMicro: 1 }, { confirmedMicro: toMicro(500) })).toMatchObject({ rule: "few-payers", confidence: "early" });
  });

  it("stops when the campaign's own spend threshold passes with nobody referred", () => {
    expect(rec({}, { confirmedMicro: toMicro(100) })).toMatchObject({ verdict: "stop_spending", rule: "spent-no-customers" });
    // Pending payments alone are not enough to call it.
    expect(rec({}, { pendingMicro: toMicro(500) }).verdict).toBe("continue_testing");
  });

  it("points at the funnel when customers arrive but don't activate or pay", () => {
    expect(rec({ referred: 40, activated: 4 }, { confirmedMicro: toMicro(50) })).toMatchObject({ verdict: "improve_funnel", rule: "low-activation" });
    expect(rec({ referred: 40, activated: 30 }, { confirmedMicro: toMicro(50) })).toMatchObject({ verdict: "improve_funnel", rule: "no-purchases" });
    expect(rec({ referred: 40, activated: 30 }, { confirmedMicro: toMicro(150) })).toMatchObject({ verdict: "stop_spending", rule: "no-purchases" });
  });

  it("judges payback only with values and margin, and distinguishes matured from maturing cohorts", () => {
    const payers = { referred: 40, activated: 30, paying: 10, purchases: 10, valuedPurchases: 10 };
    expect(rec({ ...payers, revenueMicro: toMicro(100) }, { confirmedMicro: toMicro(300) }, null)).toMatchObject({ verdict: "continue_testing", rule: "value-unknown" });
    expect(rec({ ...payers, revenueMicro: toMicro(800) }, { confirmedMicro: toMicro(300) })).toMatchObject({ verdict: "continue_testing", rule: "paid-back", confidence: "measured" });
    // 50 gross profit on 300 spend (17%), 8 of 10 payers past the window → stop.
    expect(rec({ ...payers, revenueMicro: toMicro(100), repeatEligible: 8 }, { confirmedMicro: toMicro(300) })).toMatchObject({ verdict: "stop_spending", rule: "far-from-payback" });
    // Same numbers but most customers are still inside the repeat window → keep testing.
    expect(rec({ ...payers, revenueMicro: toMicro(100), repeatEligible: 2 }, { confirmedMicro: toMicro(300) })).toMatchObject({ verdict: "continue_testing", rule: "recovering" });
  });
});

// ───────────────────────── database: ingest → report, per workspace ─────────────────────────

let db: DB;
let s: typeof import("@/server/db/schema");
let cv: typeof import("@/server/domain/growth/customer-value");
let attribution: typeof import("@/server/domain/growth/attribution");

async function workspace(id: string, mode: "LIVE" | "DEMO" = "LIVE") {
  await db.insert(s.projects).values({ id, ownerId: "u_cv", name: id, webhookSecret: "w", dataMode: mode });
  await db.insert(s.missions).values({ id: `${id}_m`, projectId: id, template: "custom", name: "M", goalDescription: "g", goalEvent: "signup", goalTarget: 10, budgetMicro: toMicro(1000), startsAt: at(60), endsAt: at(-30), dataMode: mode });
  await db.insert(s.experiments).values({ id: `${id}_x`, projectId: id, missionId: `${id}_m`, number: 1, title: `${id} experiment`, hypothesis: "h", channel: "content", budgetCategory: "content", target: "t", action: "a", budgetMicro: toMicro(400), successEvent: "signup", successTarget: 10, stopMaxCpaMicro: toMicro(20), stopAfterSpendMicro: toMicro(200), timeframeDays: 30, status: "running", dataMode: mode });
  await db.insert(s.experiments).values({ id: `${id}_untracked`, projectId: id, missionId: `${id}_m`, number: 2, title: "no link", hypothesis: "h", channel: "research", budgetCategory: "research", target: "t", action: "a", budgetMicro: toMicro(10), successEvent: "signup", successTarget: 1, stopMaxCpaMicro: 1, stopAfterSpendMicro: 1, timeframeDays: 7, dataMode: mode });
  const code = `${id.replace(/[^a-z0-9]/g, "")}code1`.slice(0, 12);
  await db.insert(s.campaigns).values({ id: `${id}_link`, experimentId: `${id}_x`, name: `${id} link`, channel: "content", utmSource: "x", utmMedium: "m", utmCampaign: "c", referralCode: code, destinationUrl: "https://example.com" });
  return code;
}

async function payment(projectId: string, key: string, state: string, usdc: number, experiment = `${projectId}_x`) {
  await db.insert(s.agentDecisions).values({ id: `${key}_d`, projectId, number: Number(key.replace(/\D/g, "")) || 1, agent: "operator", kind: "pay", action: {}, rationale: "r", status: "executed", dataMode: "LIVE" });
  await db.insert(s.transactions).values({ id: key, projectId, decisionId: `${key}_d`, experimentId: experiment, kind: "send", rail: "app_kit_send", budgetCategory: "content", amountMicro: toMicro(usdc), chain: "Arc", state, idempotencyKey: key, dataMode: "LIVE" });
}

describe("customer value report (database)", () => {
  let codeA = "";
  let codeB = "";

  beforeAll(async () => {
    const client = await import("@/server/db/client");
    db = await client.getDb();
    s = client.schema;
    cv = await import("@/server/domain/growth/customer-value");
    attribution = await import("@/server/domain/growth/attribution");
    await db.insert(s.users).values({ id: "u_cv", email: "cv@example.com", name: "CV", passwordHash: "x" });
    codeA = await workspace("wsa");
    codeB = await workspace("wsb");
    const rec = (projectId: string, e: { type: "visit" | "signup" | "purchase"; ref?: string; visitor?: string; key: string; days: number; value?: number; orderId?: string; mode?: "LIVE" | "DEMO" }) =>
      attribution.recordConversion(db, { projectId, eventType: e.type, referralCode: e.ref, visitorId: e.visitor, idempotencyKey: `${projectId}:${e.key}`, occurredAt: at(e.days), valueMicro: e.value ? toMicro(e.value) : 0, metadata: e.orderId ? { orderId: e.orderId } : {}, source: "webhook", dataMode: e.mode ?? "LIVE" });

    // Workspace A: one referred customer who signs up, then buys twice (once resent), plus an anonymous referred signup.
    await rec("wsa", { type: "visit", ref: codeA, visitor: "cookie-1", key: "v1", days: 50 });
    await rec("wsa", { type: "signup", ref: codeA, visitor: "alice@example.com", key: "s1", days: 49 });
    await rec("wsa", { type: "purchase", visitor: "alice@example.com", key: "p1", days: 40, value: 60, orderId: "A-1" });
    await rec("wsa", { type: "purchase", visitor: "alice@example.com", key: "p1-retry", days: 40, value: 60, orderId: "A-1" });
    await rec("wsa", { type: "purchase", visitor: "alice@example.com", key: "p2", days: 30, value: 40, orderId: "A-2" });
    await rec("wsa", { type: "signup", ref: codeA, key: "s-anon", days: 45 });
    await rec("wsa", { type: "purchase", visitor: "alice@example.com", key: "p-demo", days: 20, value: 999, mode: "DEMO" }); // demo data never mixes into live numbers
    // Workspace B uses the same customer ID for a different person, with a big purchase.
    await rec("wsb", { type: "signup", ref: codeB, visitor: "alice@example.com", key: "s1", days: 49 });
    await rec("wsb", { type: "purchase", visitor: "alice@example.com", key: "p1", days: 40, value: 5000 });

    await payment("wsa", "tx1", "SETTLED", 50);
    await payment("wsa", "tx2", "AWAITING_APPROVAL", 25);
    await payment("wsa", "tx3", "FAILED", 70);
    await payment("wsb", "tx4", "SETTLED", 900);
  });

  it("builds cohorts from ingested events, deduplicated, with confirmed vs pending cost", async () => {
    const r = await cv.loadCustomerValue(db, "wsa", NOW);
    expect(r.rows.map((x) => x.experimentId)).toEqual(["wsa_x"]);
    expect(r.untrackedExperiments).toBe(1);
    const [row] = r.rows;
    expect(row.cohort).toMatchObject({ referred: 1, activated: 1, paying: 1, purchases: 2, repeat: 1, repeatEligible: 1, revenueMicro: toMicro(100), linkVisitors: 1, unlinkedEvents: 1 });
    expect(r.duplicatesRemoved).toBe(1);
    expect(row.cost).toMatchObject({ budgetMicro: toMicro(400), confirmedMicro: toMicro(50), pendingMicro: toMicro(25), notPaidMicro: toMicro(70) });
    expect(row.value.costPerPaying.value).toBe(toMicro(50));
    expect(row.value.grossProfit.value).toBeNull(); // no margin set
    expect(row.recommendation).toMatchObject({ rule: "small-sample", confidence: "early" });
    expect(r.gaps.map((g) => g.key)).toContain("no-margin");
  });

  it("keeps workspaces apart even when they share a customer ID", async () => {
    const a = await cv.loadCustomerValue(db, "wsa", NOW);
    const b = await cv.loadCustomerValue(db, "wsb", NOW);
    expect(a.rows[0].cohort.revenueMicro).toBe(toMicro(100));
    expect(b.rows[0].cohort.revenueMicro).toBe(toMicro(5000));
    expect(a.ledger.every((t) => t.experimentId === "wsa_x")).toBe(true);
    expect(b.rows[0].cost.confirmedMicro).toBe(toMicro(900));
    expect(a.events.some((e) => e.valueMicro === toMicro(5000))).toBe(false);
    // A referral code from workspace B is refused when replayed into workspace A.
    await expect(attribution.recordConversion(db, { projectId: "wsa", eventType: "signup", referralCode: codeB, visitorId: "mallory", idempotencyKey: "wsa:x-replay", source: "webhook", dataMode: "LIVE" })).rejects.toThrow(/does not belong/);
  });

  it("shows customers only as workspace-scoped aliases", () => {
    const a = cv.customerAlias("wsa", "alice@example.com");
    expect(a).toMatch(/^cus_[0-9a-f]{8}$/);
    expect(a).not.toContain("alice");
    expect(cv.customerAlias("wsa", "alice@example.com")).toBe(a);
    expect(cv.customerAlias("wsb", "alice@example.com")).not.toBe(a);
  });

  it("applies the saved activation event and repeat window", async () => {
    expect(await cv.getCohortConfig(db, "wsa")).toMatchObject({ activationEvent: "signup", repeatWindowDays: 90, saved: false, marginPct: null });
    await db.insert(s.customerValueSettings).values({ projectId: "wsa", activationEvent: "booking", repeatWindowDays: 7 });
    await db.insert(s.projectEconomics).values({ projectId: "wsa", grossMarginPct: 50 });
    const r = await cv.loadCustomerValue(db, "wsa", NOW);
    expect(r.config).toMatchObject({ activationEvent: "booking", repeatWindowDays: 7, saved: true, marginPct: 50 });
    // 2nd purchase came 10 days after the first: no longer a repeat inside a 7-day window.
    expect(r.rows[0].cohort).toMatchObject({ activated: 0, repeat: 0, repeatEligible: 1 });
    expect(r.rows[0].value.payback).toMatchObject({ value: 1, kind: "estimate" }); // 100 × 50% = 50 = confirmed spend
    expect(r.gaps.map((g) => g.key)).toContain("no-activation");
    // Workspace B's definitions are untouched.
    expect((await cv.getCohortConfig(db, "wsb")).saved).toBe(false);
  });
});
