import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { calculateReward, netPurchases } from "../packages/arc-growth-tools/src/outcomes";
import { eligiblePurchase, reduceCommerce, type CommerceEvent } from "../packages/arc-growth-tools/src/commerce";
import { evaluateSpend, executeReservedSpend, reserveSpend, type ReservationStore, type SpendIntent, type SpendPolicy } from "../packages/arc-growth-tools/src/policy";
import { createReceipt, verifyReceipt, verifyTransfers } from "../packages/arc-growth-tools/src/evidence";

const contract = `0x${"1".repeat(40)}`, hash = `0x${"2".repeat(64)}`;
const event = (operation: CommerceEvent["operation"], amountMicro: number, logIndex: number): CommerceEvent => ({ operation, amountMicro, logIndex, contract, txHash: hash, chainId: 5042002, paymentId: "order1", blockNumber: "10", occurredAt: "2026-10-14T12:00:00Z" });
const intent: SpendIntent = { id: "reward1", scope: "campaign1", recipient: contract, asset: "USDC", chainId: 5042002, amountMicro: 5, category: "creator", expiresAt: 100 };
const policy: SpendPolicy = { frozen: false, allowedChains: [5042002], allowedAssets: ["USDC"], allowedRecipients: [contract], allowedCategories: ["creator"], hardLimitMicro: 10, budgetMicro: 10, dailyLimitMicro: 10, approvalAboveMicro: 2, alwaysReviewCategories: ["creator"] };

/** Deliberately isolated from GrowTendril: implements the public storage adapter. */
function memoryStore(): ReservationStore {
  const entries = new Map<string, { intent: SpendIntent; state: "reserved" | "executing" | "submitted"; txHash?: string }>();
  let lock = Promise.resolve();
  return {
    async locked(_scope, work) { const before = lock; let release!: () => void; lock = new Promise<void>(r => { release = r; }); await before; try { return await work(); } finally { release(); } },
    async get(id) { return entries.get(id) ?? null; },
    async state(scope) { const committedMicro = [...entries.values()].filter(e => e.intent.scope === scope).reduce((n,e) => n + e.intent.amountMicro, 0); return { committedMicro, spentTodayMicro: committedMicro }; },
    async put(i, state, txHash) { entries.set(i.id, { intent: { ...i }, state, txHash }); },
  };
}

describe("portable Arc growth tools", () => {
  it("caps bonuses and uses integer quality rewards", () => {
    expect(calculateReward({ baseMicro: 10, qualityBonusMicro: 9, outcomeBonusMicro: 2, outcomeCap: 3 }, 75, 9)).toMatchObject({ qualityMicro: 6, outcomeMicro: 6, totalMicro: 22 });
    expect(() => calculateReward({ baseMicro: 10, qualityBonusMicro: 9, outcomeBonusMicro: 2, outcomeCap: 3 }, 101, 0)).toThrow();
    expect(() => calculateReward({ baseMicro: Number.MAX_SAFE_INTEGER, qualityBonusMicro: 1, outcomeBonusMicro: 0, outcomeCap: 0 }, 100, 0)).toThrow();
  });
  it("keeps unrelated orders separate and caps refunds at recorded revenue", () => {
    const base = { customerId: "customer", occurredAt: new Date(), type: "purchase" };
    const n = netPurchases([{ ...base, id: "p", orderId: "one", valueMicro: 20 }, { ...base, id: "p2", orderId: "two", valueMicro: 10 }, { ...base, type: "refund", id: "r", orderId: "one", valueMicro: 30 }, { ...base, type: "refund", id: "orphan", orderId: "missing", valueMicro: 3 }]);
    expect(n.purchases.map(p => p.valueMicro)).toEqual([0, 10]); expect(n.refundedMicro).toBe(20); expect(n.unmatchedRefunds).toBe(1);
  });
  it("replays capture/refund events once, even when delivered out of order", () => {
    const a = event("Authorized", 100, 0), c = event("Captured", 40, 1), d = event("Captured", 60, 2), r = event("Refunded", 25, 3);
    expect(reduceCommerce([r, d, a, c, d])).toEqual({ authorizedMicro: 100, capturedMicro: 100, refundedMicro: 25, status: "partially_refunded" });
    expect(() => reduceCommerce([a, c, { ...c, amountMicro: 99 }])).toThrow(/Conflicting/);
    expect(() => reduceCommerce([a, event("Captured", 101, 1)])).toThrow(/exceeds/);
    expect(() => reduceCommerce([event("Charged", 20, 0), event("Refunded", 21, 1)])).toThrow(/exceeds/);
  });
  it("requires full capture, retained value and the refund hold", () => {
    const order = reduceCommerce([event("Charged", 20, 0)]);
    expect(eligiblePurchase(order, 10, 20, 11)).toBe(false);
    expect(eligiblePurchase(order, 10, 21, 11)).toBe(true);
    expect(eligiblePurchase(reduceCommerce([event("Charged", 20, 0), event("Refunded", 20, 1)]), 10, 100, 11)).toBe(false);
  });
  it("approval cannot override a frozen wallet, expired intent or changed recipient", () => {
    const approval = { intent, approver: "owner", approvedAt: 1 };
    expect(evaluateSpend(intent, policy, { committedMicro: 0, spentTodayMicro: 0 }, 2).verdict).toBe("APPROVAL_REQUIRED");
    expect(evaluateSpend(intent, policy, { committedMicro: 0, spentTodayMicro: 0 }, 2, approval).verdict).toBe("ALLOW");
    expect(evaluateSpend(intent, { ...policy, frozen: true }, { committedMicro: 0, spentTodayMicro: 0 }, 2, approval).verdict).toBe("DENY");
    expect(evaluateSpend({ ...intent, recipient: hash }, policy, { committedMicro: 0, spentTodayMicro: 0 }, 2, approval).verdict).toBe("DENY");
    expect(evaluateSpend(intent, policy, { committedMicro: 0, spentTodayMicro: 0 }, 100, approval).verdict).toBe("DENY");
  });
  it("serializes competing reservations and refuses idempotency collisions", async () => {
    const store = memoryStore(), automatic = { ...policy, alwaysReviewCategories: [], approvalAboveMicro: 10 };
    const results = await Promise.all([1,2,3].map(n => reserveSpend(store, { ...intent, id: `i${n}` }, automatic, 1)));
    expect(results.filter(r => r.verdict === "ALLOW")).toHaveLength(2);
    await expect(reserveSpend(store, { ...intent, id: "i1", amountMicro: 4 }, automatic, 1)).rejects.toThrow(/Idempotency/);
  });
  it("rechecks current policy and claims execution only once", async () => {
    const store = memoryStore(), approval = { intent, approver: "owner", approvedAt: 1 };
    await reserveSpend(store, intent, policy, 2, approval);
    let sends = 0;
    const wallet = { async send() { sends++; return { txHash: hash }; } };
    await expect(executeReservedSpend(store, intent, async () => ({ ...policy, frozen: true }), () => 3, wallet, approval)).rejects.toThrow(/frozen/);
    await Promise.all([1,2].map(() => executeReservedSpend(store, intent, async () => policy, () => 3, wallet, approval)));
    expect(sends).toBe(1); expect((await store.get(intent.id))?.state).toBe("submitted");
  });
  it("keeps an ambiguous external failure claimed for reconciliation", async () => {
    const store = memoryStore(), approval = { intent, approver: "owner", approvedAt: 1 };
    await reserveSpend(store, intent, policy, 2, approval);
    let sends = 0; const wallet = { async send(): Promise<{txHash:string}> { sends++; throw new Error("timeout after submission"); } };
    await expect(executeReservedSpend(store, intent, async () => policy, () => 3, wallet, approval)).rejects.toThrow(/timeout/);
    await executeReservedSpend(store, intent, async () => policy, () => 3, wallet, approval);
    expect(sends).toBe(1); expect((await store.get(intent.id))?.state).toBe("executing");
  });
  it("distinguishes receipt integrity from trusted issuer authentication", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = createReceipt({ reward: 5, evidence: "fixture" }, "merchant", "key1", privateKey);
    expect(verifyReceipt(receipt, { key1: { issuer: "merchant", publicKey } })).toEqual({ integrity: true, authenticated: true });
    expect(verifyReceipt(receipt, {})).toEqual({ integrity: true, authenticated: false });
    expect(verifyReceipt({ ...receipt, body: { reward: 6 } }, { key1: { issuer: "merchant", publicKey } })).toEqual({ integrity: false, authenticated: false });
  });
  it("does not certify a pending receipt, wrong network or extra outflow", () => {
    const expected = { chainId: 5042002, asset: "USDC", sender: "sender", recipient: "creator", amountMicro: 5 };
    const evidence = { status: "confirmed" as const, chainId: 5042002, txHash: hash, transfers: [expected] };
    expect(verifyTransfers(expected, evidence).status).toBe("verified");
    expect(verifyTransfers(expected, { ...evidence, status: "pending" }).status).toBe("pending");
    expect(verifyTransfers(expected, { ...evidence, chainId: 1 }).status).toBe("mismatch");
    expect(verifyTransfers(expected, { ...evidence, transfers: [...evidence.transfers, { ...expected, recipient: "other", amountMicro: 1 }] }).status).toBe("mismatch");
  });
});
