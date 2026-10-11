import { describe, it, expect } from "vitest";
import { evaluatePolicy, DEFAULT_POLICY, type PolicyState } from "../src/server/domain/agent/policy";
import { parseFinancialAction } from "../src/server/domain/agent/actions";
import { toMicro } from "../src/lib/money";

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
    chain: "Arc",
  });

const send = (amount: string, purpose = "kol_payment") =>
  parseFinancialAction({
    action: "send_payment",
    purpose,
    recipient: "0x933a2405f84c224be1ef373ba16e992e1f459682",
    amount,
    currency: "USDC",
    chain: "Arc",
    experimentId: "e1",
    reasonCode: "PAY_CREATOR",
    expectedValue: "high",
    missionId: "m1",
    confidence: 0.91,
  });

describe("policy engine", () => {
  it("requires founder approval even for a sub-cent research purchase", () => {
    const a = purchase("0.08");
    expect(a.success).toBe(true);
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state());
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    expect(r.checks.find((c) => c.rule === "MAINNET_FOUNDER_APPROVAL")?.passed).toBe(false);
  });

  it("denies a creator payment above the mainnet hard ceiling", () => {
    const a = send("250");
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state({ categoryAllocatedMicro: toMicro(300) }));
    expect(r.verdict).toBe("DENY");
    expect(r.checks.find((c) => c.rule === "HARD_CEILING")?.passed).toBe(false);
  });

  it("DENYs a 2,000 USDC transfer even with founder approval", () => {
    const a = send("2000", "campaign_payment");
    const r = evaluatePolicy(a.data!, DEFAULT_POLICY, state(), { founderApproved: true });
    expect(r.verdict).toBe("DENY");
    expect(r.checks.filter((c) => !c.passed).map((c) => c.rule)).toEqual(expect.arrayContaining(["HARD_CEILING", "MISSION_BUDGET"]));
  });

  it("approval waives approval rules but re-checks deny rules", () => {
    const a = send("5");
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ categoryAllocatedMicro: toMicro(300) }), { founderApproved: true }).verdict).toBe("ALLOW");
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ walletFrozen: true }), { founderApproved: true }).verdict).toBe("DENY");
  });

  it("DENYs a disallowed chain", () => {
    const a = parseFinancialAction({ ...purchase("0.01").data!, chain: "Ethereum_Sepolia" });
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state()).verdict).toBe("DENY");
  });

  it("keeps approval mandatory even when a stored policy permits autonomous spend", () => {
    const oldPolicy = { ...DEFAULT_POLICY, maxTransactionMicro: toMicro(500), hardCeilingMicro: toMicro(500), autonomousCategories: ["research"], approvalCategories: [], allowedChains: ["Arc", "Arc_Testnet"] };
    const request = purchase("0.01").data!;
    expect(evaluatePolicy(request, oldPolicy, state()).verdict).toBe("APPROVAL_REQUIRED");
    const legacyRequest = parseFinancialAction({ ...request, chain: "Arc_Testnet" });
    expect(evaluatePolicy(legacyRequest.data!, oldPolicy, state(), { founderApproved: true }).verdict).toBe("DENY");
    expect(evaluatePolicy(send("11").data!, oldPolicy, state(), { founderApproved: true }).verdict).toBe("DENY");
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
    expect(evaluatePolicy(a.data!, DEFAULT_POLICY, state({ experimentRemainingMicro: { e1: toMicro(40) } })).verdict).toBe("APPROVAL_REQUIRED");
  });
});
