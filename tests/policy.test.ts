import { describe, it, expect } from "vitest";
import { evaluatePolicy, DEFAULT_POLICY, type PolicyState } from "../src/server/domain/agent/policy";
import { parseFinancialAction } from "../src/server/domain/agent/actions";
import { toMicro } from "../src/lib/money";
import { ARC } from "../src/server/integrations/circle/config";

process.env.PGLITE_DIR = "memory://";

const state = (o: Partial<PolicyState> = {}): PolicyState => ({
  walletConfigured: true,
  walletFrozen: false,
  spentTodayMicro: toMicro(18.42),
  missionBudgetMicro: toMicro(500),
  missionCommittedMicro: toMicro(183),
  missionActive: true,
  categoryAllocatedMicro: toMicro(75),
  categoryCommittedMicro: 0,
  serviceKnown: true,
  gatewayAvailableMicro: toMicro(1000),
  walletUsdcMicro: toMicro(1000),
  ...o,
});

const purchase = (amount: string) =>
  parseFinancialAction({
    action: "purchase_service",
    serviceId: "svc_1",
    resourceUrl: "https://signals.example.com/v1/company",
    amount,
    currency: "USDC",
    reasonCode: "VERIFY_CUSTOMER_INTENT",
    expectedValue: "high",
    missionId: "m1",
    confidence: 0.67,
    subject: { type: "company", id: "c1" },
    chain: ARC.appKitChain,
  });

const send = (amount: string, purpose = "kol_payment", recipient = "0x933a2405f84c224be1ef373ba16e992e1f459682") =>
  parseFinancialAction({
    action: "send_payment",
    purpose,
    recipient,
    amount,
    currency: "USDC",
    chain: ARC.appKitChain,
    experimentId: "e1",
    reasonCode: "PAY_CREATOR",
    expectedValue: "high",
    missionId: "m1",
    confidence: 0.91,
  });

describe("policy engine", () => {
  it("ALLOWs a sub-cent research purchase", () => {
    const a = purchase("0.08");
    expect(a.success).toBe(true);
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state());
    expect(r.verdict).toBe("ALLOW");
  });

  it("requires APPROVAL for a 250 USDC KOL payment", () => {
    const a = send("250");
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state({ categoryAllocatedMicro: toMicro(300) }));
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    expect(r.checks.find((c) => c.rule === "KOL_APPROVAL_THRESHOLD")?.passed).toBe(false);
  });

  it("DENYs a 2,000 USDC transfer even with founder approval", () => {
    const a = send("2000", "campaign_payment");
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state(), { founderApproved: true });
    expect(r.verdict).toBe("DENY");
    expect(r.checks.filter((c) => !c.passed).map((c) => c.rule)).toEqual(expect.arrayContaining(["HARD_CEILING", "MISSION_BUDGET"]));
  });

  it("approval waives approval rules but re-checks deny rules", () => {
    const a = send("150");
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ categoryAllocatedMicro: toMicro(300) }), { founderApproved: true }).verdict).toBe("ALLOW");
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ walletFrozen: true }), { founderApproved: true }).verdict).toBe("DENY");
  });

  it("DENYs a disallowed chain", () => {
    const a = parseFinancialAction({ ...purchase("0.01").data!, chain: "Ethereum_Sepolia" });
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state()).verdict).toBe("DENY");
  });

  it("escalates when the daily limit would be exceeded", () => {
    const r = evaluatePolicy(purchase("5").data!, DEFAULT_POLICY, state({ spentTodayMicro: toMicro(48) }));
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    expect(r.checks.find((c) => c.rule === "DAILY_SPEND")?.passed).toBe(false);
  });

  it("DENYs when no wallet is configured", () => {
    expect(evaluatePolicy(purchase("0.01").data!, DEFAULT_POLICY, state({ walletConfigured: false })).verdict).toBe("DENY");
  });

  it("rejects free-form and malformed actions at the schema", () => {
    expect(parseFinancialAction({ action: "send_payment", text: "pay the influencer 200" }).success).toBe(false);
    expect(purchase("0.0000001").success).toBe(false);
    expect(purchase("-5").success).toBe(false);
    expect(send("10", "mass_unsolicited_messaging").success).toBe(false);
  });

  it("reallocation must come from unspent budget", () => {
    const a = parseFinancialAction({
      action: "reallocate_budget",
      missionId: "m1",
      confidence: 0.9,
      reasonCode: "REALLOCATE_TO_WINNER",
      moves: [{ fromExperimentId: "e1", toExperimentId: "e2", amount: "30", reason: "CPA" }],
    });
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ experimentRemainingMicro: { e1: toMicro(20) } })).verdict).toBe("DENY");
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ experimentRemainingMicro: { e1: toMicro(40) } })).verdict).toBe("ALLOW");
  });

  it("RECIPIENT_VALID denies the zero and burn addresses, except in simulation", () => {
    for (const r of ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dEaD"]) {
      const a = send("5", "developer_bounty", r).data!;
      const res = evaluatePolicy(a, DEFAULT_POLICY, state(), { founderApproved: true });
      expect(res.verdict).toBe("DENY");
      expect(res.checks.find((c) => c.rule === "RECIPIENT_VALID")?.passed).toBe(false);
      expect(evaluatePolicy(a, DEFAULT_POLICY, state({ simulation: true })).checks.find((c) => c.rule === "RECIPIENT_VALID")?.passed).toBe(true);
    }
    expect(evaluatePolicy(send("5", "developer_bounty").data!, DEFAULT_POLICY, state()).checks.find((c) => c.rule === "RECIPIENT_VALID")?.passed).toBe(true);
  });

  it("BALANCE_SUFFICIENT: Gateway for x402, wallet for sends; insufficient is a DENY", () => {
    const rule = (r: ReturnType<typeof evaluatePolicy>) => r.checks.find((c) => c.rule === "BALANCE_SUFFICIENT")!;
    // x402 purchase reads the Gateway balance, not the wallet.
    expect(evaluatePolicy(purchase("0.08").data!, DEFAULT_POLICY, state({ gatewayAvailableMicro: toMicro(1), walletUsdcMicro: 0 })).verdict).toBe("ALLOW");
    const poor = evaluatePolicy(purchase("0.08").data!, DEFAULT_POLICY, state({ gatewayAvailableMicro: toMicro(0.05), walletUsdcMicro: toMicro(100) }), { founderApproved: true });
    expect(poor.verdict).toBe("DENY");
    expect(rule(poor).passed).toBe(false);
    // Sends read the wallet balance.
    expect(evaluatePolicy(send("5", "developer_bounty").data!, DEFAULT_POLICY, state({ walletUsdcMicro: toMicro(4), gatewayAvailableMicro: toMicro(100) })).verdict).toBe("DENY");
    expect(rule(evaluatePolicy(send("5", "developer_bounty").data!, DEFAULT_POLICY, state({ walletUsdcMicro: toMicro(5) }))).passed).toBe(true);
  });

  it("BALANCE_SUFFICIENT: unknown balance → approval on mainnet, unchecked on testnet, skipped in simulation", () => {
    const a = purchase("0.08").data!;
    const main = evaluatePolicy(a, DEFAULT_POLICY, state({ gatewayAvailableMicro: null, mainnet: true }));
    expect(main.verdict).toBe("APPROVAL_REQUIRED");
    expect(main.checks.find((c) => c.rule === "BALANCE_SUFFICIENT")?.severity).toBe("approval");
    expect(evaluatePolicy(a, DEFAULT_POLICY, state({ gatewayAvailableMicro: null, mainnet: true }), { founderApproved: true }).verdict).toBe("ALLOW");
    const test = evaluatePolicy(a, DEFAULT_POLICY, state({ gatewayAvailableMicro: null, mainnet: false }));
    expect(test.verdict).toBe("ALLOW");
    expect(test.checks.find((c) => c.rule === "BALANCE_SUFFICIENT")?.detail).toMatch(/unknown/);
    expect(evaluatePolicy(a, DEFAULT_POLICY, state({ simulation: true, gatewayAvailableMicro: 0, mainnet: true })).verdict).toBe("ALLOW");
  });
});

describe("payout recipients", () => {
  it("falls back to a placeholder only for simulated DEMO payments", async () => {
    const { payoutAddressFor, DEMO_PAYOUT_FALLBACK } = await import("../src/server/domain/growth/experiments");
    const creator = "0x1111111111111111111111111111111111111111";
    expect(payoutAddressFor(creator, { placeholderOk: false })).toBe(creator);
    expect(payoutAddressFor(null, { placeholderOk: false })).toBeNull();
    expect(payoutAddressFor(DEMO_PAYOUT_FALLBACK, { placeholderOk: false })).toBeNull();
    expect(payoutAddressFor(null, { placeholderOk: true })).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("experiment tranches (real Postgres via PGlite)", { timeout: 60_000 }, () => {
  it("pays each tranche at most once, withholds tranche 2 on the stop condition, and leaves no orphan decisions", async () => {
    const { getDb, schema: s } = await import("../src/server/db/client");
    const { eq } = await import("drizzle-orm");
    const { seedDemo } = await import("../src/server/demo/seed");
    const { runDemoStep } = await import("../src/server/demo/script");
    const { launchExperiment, trancheState } = await import("../src/server/domain/growth/experiments");
    const { resolveApproval } = await import("../src/server/domain/agent/execute");
    const db = await getDb();
    const pid = await seedDemo(db, {});
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, pid));
    await runDemoStep(db, pid, 1, project.ownerId);
    await runDemoStep(db, pid, 3, project.ownerId);
    const exp = (await db.select().from(s.experiments).where(eq(s.experiments.projectId, pid))).sort((a, b) => b.number - a.number)[0];
    const decisions = async () => (await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.projectId, pid))).length;

    const first = await launchExperiment(db, { projectId: pid, experimentId: exp.id });
    expect(first.state).toBe("AWAITING_APPROVAL");
    const n = await decisions();
    // Tranche 2 can't jump the queue, and a repeat of tranche 1 is refused without a new decision.
    expect((await launchExperiment(db, { projectId: pid, experimentId: exp.id, tranche: "second" })).verdict).toBe("NOT_PROPOSED");
    await db.update(s.experiments).set({ status: "proposed" }).where(eq(s.experiments.id, exp.id));
    const again = await launchExperiment(db, { projectId: pid, experimentId: exp.id });
    expect(again.verdict).toBe("NOT_PROPOSED");
    expect(again.decisionId).toBe(first.decisionId);
    expect(await decisions()).toBe(n);
    await db.update(s.experiments).set({ status: "awaiting_approval" }).where(eq(s.experiments.id, exp.id));

    const [ap] = await db.select().from(s.approvals).where(eq(s.approvals.decisionId, first.decisionId!));
    const resolved = await resolveApproval(db, { approvalId: ap.id, userId: project.ownerId, resolution: "approve" });
    expect(resolved).toMatchObject({ status: "approved", state: "SIMULATED" });

    // Tranche 1 spent, no conversions yet → stop condition hit → tranche 2 withheld.
    const [running] = await db.select().from(s.experiments).where(eq(s.experiments.id, exp.id));
    expect(running.status).toBe("running");
    expect((await trancheState(db, running)).stopHit).toBe(true);
    const withheld = await launchExperiment(db, { projectId: pid, experimentId: exp.id, tranche: "second" });
    expect(withheld.verdict).toBe("NOT_PROPOSED");
    expect(withheld.message).toMatch(/Stop condition/);

    // Conversions arrive at an acceptable CPA → tranche 2 is proposed once, with its own payoutRef.
    await runDemoStep(db, pid, 7, project.ownerId);
    const second = await launchExperiment(db, { projectId: pid, experimentId: exp.id, tranche: "second" });
    expect(second.state).toBe("AWAITING_APPROVAL");
    const [d2] = await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.id, second.decisionId!));
    expect((d2.action as { payoutRef?: string }).payoutRef).toBe("tranche:2");
    const m = await decisions();
    expect((await launchExperiment(db, { projectId: pid, experimentId: exp.id, tranche: "second" })).verdict).toBe("NOT_PROPOSED");
    expect(await decisions()).toBe(m);
    const [after] = await db.select().from(s.experiments).where(eq(s.experiments.id, exp.id));
    expect(after.status).toBe("running");
  });

  it("proposes nothing for a LIVE creator without a payout address", async () => {
    const { getDb, schema: s } = await import("../src/server/db/client");
    const { eq } = await import("drizzle-orm");
    const { launchExperiment } = await import("../src/server/domain/growth/experiments");
    const { seedDemo } = await import("../src/server/demo/seed");
    const { runDemoStep } = await import("../src/server/demo/script");
    const db = await getDb();
    // Fresh demo workspace with a newly proposed creator experiment.
    const pid = await seedDemo(db, { reset: true });
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, pid));
    await runDemoStep(db, pid, 3, project.ownerId);
    const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.projectId, pid)).then((rows) => rows.filter((x) => x.status === "proposed"));
    expect(exp).toBeTruthy();
    const [camp] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
    if (camp?.kolId) await db.update(s.kols).set({ payoutAddress: null }).where(eq(s.kols.id, camp.kolId));
    await db.update(s.projects).set({ dataMode: "LIVE" }).where(eq(s.projects.id, exp.projectId));
    const before = (await db.select().from(s.agentDecisions)).length;
    const r = await launchExperiment(db, { projectId: exp.projectId, experimentId: exp.id });
    expect(r.verdict).toBe("NOT_PROPOSED");
    expect(r.state).toBe("NO_RECIPIENT");
    expect((await db.select().from(s.agentDecisions)).length).toBe(before);
    const [still] = await db.select().from(s.experiments).where(eq(s.experiments.id, exp.id));
    expect(still.status).toBe("proposed");
  });
});
