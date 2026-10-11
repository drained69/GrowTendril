import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
const external = vi.hoisted(() => ({ sends: 0, rpcFails: false, noHash: false, incoming: [] as { txHash: string; from: string; amountMicro: number; blockNumber: bigint }[], wallet: {} as Record<string, unknown> }));
vi.mock("@/server/integrations/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({ appKitSend: async () => {
  external.sends++;
  return { state: "success", txHash: external.noHash ? null : `0x${external.sends.toString(16).padStart(64, "0")}`, explorerUrl: null, steps: [] };
} }));
vi.mock("@/server/integrations/circle/client", () => ({ circleClient: async () => ({ getWallet: async () => ({ data: { wallet: external.wallet } }) }) }));
vi.mock("@/server/domain/billing/arc", async (original) => ({
  ...await original<typeof import("@/server/domain/billing/arc")>(),
  currentBlock: async () => 1000n,
  transfersTo: async () => external.incoming,
  payoutInTx: async () => { if (external.rpcFails) throw new Error("Arc temporarily unavailable"); return { status: "pending", toRecipientMicro: 0, elsewhere: [] }; },
}));

let db: DB;
let s: typeof import("@/server/db/schema");
let billing: typeof import("@/server/domain/billing");
let experiments: typeof import("@/server/domain/growth/experiments");
let execute: typeof import("@/server/domain/agent/execute");
let learning: typeof import("@/server/domain/growth/learning-run");
let attribution: typeof import("@/server/domain/growth/attribution");
let decisions: typeof import("@/server/domain/agent/decisions");
const micro = (n: number) => n * 1_000_000;
const ADDRESS = "0x1111111111111111111111111111111111111111";
let number = 0;

beforeAll(async () => {
  const client = await import("@/server/db/client"); db = await client.getDb(); s = client.schema;
  billing = await import("@/server/domain/billing"); experiments = await import("@/server/domain/growth/experiments");
  execute = await import("@/server/domain/agent/execute"); learning = await import("@/server/domain/growth/learning-run");
  attribution = await import("@/server/domain/growth/attribution"); decisions = await import("@/server/domain/agent/decisions");
  const { DEFAULT_POLICY } = await import("@/server/domain/agent/policy");
  await db.insert(s.users).values([{ id: "u", email: "owner@example.test", name: "Owner", passwordHash: "x" }, { id: "u2", email: "other@example.test", name: "Other", passwordHash: "x" }]);
  await db.insert(s.projects).values([{ id: "p", ownerId: "u", name: "P", webhookSecret: "x" }, { id: "p2", ownerId: "u2", name: "P2", webhookSecret: "x" }]);
  await db.insert(s.missions).values(["p", "p2"].map((projectId) => ({ id: `m-${projectId}`, projectId, template: "first_customers", name: "Growth", goalDescription: "Find customers", goalEvent: "purchase", goalTarget: 100, budgetMicro: micro(200), startsAt: new Date("2026-01-01"), endsAt: new Date("2027-01-01"), status: "active", dataMode: "LIVE" as const })));
  await db.insert(s.policies).values({ id: "policy", projectId: "p", ...DEFAULT_POLICY });
  await db.insert(s.wallets).values({ id: "wallet", projectId: "p", provider: "circle_dcw", address: ADDRESS, circleWalletId: "cw", blockchain: "ARC", status: "ACTIVE", dataMode: "LIVE" });
});
afterEach(() => { delete process.env.BILLING_ARC_ADDRESS; external.rpcFails = false; external.noHash = false; external.incoming = []; });

async function experiment(id: string, budget = 20, projectId = "p") {
  const [row] = await db.insert(s.experiments).values({ id, projectId, missionId: `m-${projectId}`, number: ++number, title: id, hypothesis: "Useful work converts", channel: "content", budgetCategory: "content", target: "1 demo", action: "Write", budgetMicro: micro(budget), successEvent: "demo_request", successTarget: 1, stopMaxCpaMicro: micro(10), stopAfterSpendMicro: micro(budget / 2), timeframeDays: 7, status: "proposed", recipientAddress: ADDRESS, dataMode: "LIVE" }).returning();
  return row;
}
async function transaction(experimentId: string, amount: number, state: string) {
  const decision = await decisions.recordDecision(db, { projectId: "p", missionId: "m-p", agent: "test", kind: "send_payment", action: {}, rationale: "Fixture", status: "approved", dataMode: "LIVE" });
  const [tx] = await db.insert(s.transactions).values({ id: `tx-${experimentId}`, projectId: "p", decisionId: decision.id, missionId: "m-p", experimentId, kind: "send", rail: "app_kit_send", budgetCategory: "content", amountMicro: micro(amount), chain: "Arc", state, idempotencyKey: `tx-${experimentId}`, dataMode: "LIVE" }).returning();
  return tx;
}

describe("financial safety regressions", () => {
  it("rolls back a paid invoice when the credit insert fails, and safely retries it", async () => {
    process.env.BILLING_ARC_ADDRESS = ADDRESS;
    const inv = await billing.createInvoice(db, "u", micro(5), { block: 10n });
    expect(inv.fromBlock).toBe("0");
    external.incoming = [{ txHash: `0x${"9".repeat(64)}`, from: ADDRESS, amountMicro: inv.amountMicro, blockNumber: 11n }];
    await db.execute(sql`create function test_credit_failure() returns trigger language plpgsql as $$ begin raise exception 'injected credit failure'; end $$`);
    await db.execute(sql`create trigger test_credit_failure before insert on credit_ledger for each row execute function test_credit_failure()`);
    try { await expect(billing.checkInvoice(db, inv)).rejects.toThrow(); }
    finally { await db.execute(sql`drop trigger test_credit_failure on credit_ledger`); await db.execute(sql`drop function test_credit_failure()`); }
    const [unpaid] = await db.select().from(s.billingInvoices).where(eq(s.billingInvoices.id, inv.id));
    expect(unpaid.status).toBe("pending");
    expect(await billing.balanceMicro(db, "u")).toBe(0);
    expect(await billing.checkInvoice(db, unpaid)).toEqual({ paid: true });
    expect(await billing.balanceMicro(db, "u")).toBe(inv.amountMicro);
    expect((await billing.ledgerFor(db, "u")).filter((l) => l.ref === inv.id)).toHaveLength(1);
  });

  it("serializes invoice creation and reuses one open invoice under concurrent requests", async () => {
    process.env.BILLING_ARC_ADDRESS = ADDRESS;
    const invoices = await Promise.all(Array.from({ length: 6 }, () => billing.createInvoice(db, "u2", micro(10))));
    expect(new Set(invoices.map((i) => i.id)).size).toBe(1);
  });

  it("credits the full payment when one transaction contains multiple transfer logs", async () => {
    process.env.BILLING_ARC_ADDRESS = ADDRESS;
    const inv = await billing.createInvoice(db, "u", micro(7));
    const before = await billing.balanceMicro(db, "u");
    const hash = `0x${"8".repeat(64)}`;
    external.incoming = [{ txHash: hash, from: ADDRESS, amountMicro: micro(3), blockNumber: 1001n }, { txHash: hash, from: ADDRESS, amountMicro: inv.amountMicro - micro(3), blockNumber: 1001n }];
    expect(await billing.checkInvoice(db, inv)).toEqual({ paid: true });
    expect(await billing.balanceMicro(db, "u")).toBe(before + inv.amountMicro);
  });

  it("rejects payments for stopped experiments both at launch and approval", async () => {
    const exp = await experiment("stopped");
    const proposal = await experiments.launchExperiment(db, { projectId: "p", experimentId: exp.id });
    expect(proposal.verdict).toBe("APPROVAL_REQUIRED");
    await db.update(s.experiments).set({ status: "stopped" }).where(eq(s.experiments.id, exp.id));
    const before = external.sends;
    expect((await execute.resolveApproval(db, { approvalId: proposal.approvalId!, userId: "u", resolution: "approve" })).status).toBe("denied");
    expect(external.sends).toBe(before);
    await expect(experiments.launchExperiment(db, { projectId: "p", experimentId: exp.id })).rejects.toThrow(/stopped/);
  });

  it("keeps a submitted payment committed when the confirmation RPC fails", async () => {
    const exp = await experiment("rpc-failure");
    const proposal = await experiments.launchExperiment(db, { projectId: "p", experimentId: exp.id });
    external.rpcFails = true;
    const result = await execute.resolveApproval(db, { approvalId: proposal.approvalId!, userId: "u", resolution: "approve" });
    expect(result.state).toBe("SUBMITTED");
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.decisionId, proposal.decisionId));
    expect(tx).toMatchObject({ state: "SUBMITTED", amountMicro: micro(10) });
    const before = external.sends;
    expect((await execute.executeChainTx(db, tx.id)).state).toBe("SUBMITTED");
    expect(external.sends).toBe(before);
    expect((await experiments.experimentCommitted(db, exp.id)).committedMicro).toBe(micro(10));
  });

  it("does not claim settlement without a transaction hash", async () => {
    const exp = await experiment("no-hash");
    const proposal = await experiments.launchExperiment(db, { projectId: "p", experimentId: exp.id });
    external.noHash = true;
    expect((await execute.resolveApproval(db, { approvalId: proposal.approvalId!, userId: "u", resolution: "approve" })).state).toBe("SUBMITTED");
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.decisionId, proposal.decisionId));
    expect(tx.chainCheck).toBe("unverified");
    expect((await db.select().from(s.ledgerExceptions).where(eq(s.ledgerExceptions.transactionId, tx.id)))[0].kind).toBe("payout_unverified");
  });

  it("reallocates only uncommitted budget atomically, scoped to one mission, once", async () => {
    await experiment("source"); await experiment("target"); await experiment("foreign", 20, "p2");
    await transaction("source", 15, "AWAITING_APPROVAL");
    const d = await decisions.recordDecision(db, { projectId: "p", missionId: "m-p", agent: "test", kind: "reallocate_budget", action: {}, rationale: "Fixture", status: "approved", dataMode: "LIVE" });
    const move = (to: string, amount: string) => [{ fromExperimentId: "source", toExperimentId: to, amount, reason: "Measured winner" }];
    await expect(learning.applyReallocation(db, "p", "m-p", d.id, move("target", "10"))).rejects.toThrow(/uncommitted/);
    await expect(learning.applyReallocation(db, "p", "m-p", d.id, move("foreign", "5"))).rejects.toThrow(/this workspace and mission/);
    expect((await db.select().from(s.experiments).where(eq(s.experiments.id, "source")))[0].budgetMicro).toBe(micro(20));
    await learning.applyReallocation(db, "p", "m-p", d.id, move("target", "5"));
    await learning.applyReallocation(db, "p", "m-p", d.id, move("target", "5"));
    expect((await db.select().from(s.experiments).where(eq(s.experiments.id, "source")))[0].budgetMicro).toBe(micro(15));
    expect((await db.select().from(s.experiments).where(eq(s.experiments.id, "target")))[0].budgetMicro).toBe(micro(25));
  });

  it("measures settled spend and each experiment's own success event", async () => {
    const exp = await experiment("measurement");
    const tx = await transaction(exp.id, 10, "AUTHORIZED");
    await db.insert(s.campaigns).values({ id: "measurement-campaign", experimentId: exp.id, name: exp.title, channel: "content", utmSource: "content", utmMedium: "content", utmCampaign: "measurement", referralCode: "measurement", destinationUrl: "" });
    await attribution.recordConversion(db, { projectId: "p", eventType: "demo_request", referralCode: "measurement", idempotencyKey: "measurement-demo", source: "manual", dataMode: "LIVE" });
    const find = async () => (await attribution.missionPerformance(db, "m-p")).find((p) => p.experimentId === exp.id)!;
    expect(await find()).toMatchObject({ spentMicro: 0, committedMicro: micro(10), conversions: 1 });
    await db.update(s.transactions).set({ state: "SETTLED" }).where(eq(s.transactions.id, tx.id));
    expect((await find()).spentMicro).toBe(micro(10));
  });

  it("refuses to attach another workspace's Circle wallet", async () => {
    const wallets = await import("@/server/integrations/circle/wallets");
    external.wallet = { id: "someone-else", address: ADDRESS, blockchain: "ARC", refId: "p", state: "LIVE", accountType: "EOA" };
    await expect(wallets.attachCircleWallet(db, { projectId: "p2", userId: "u2", circleWalletId: "someone-else" })).rejects.toThrow(/not assigned/);
    external.wallet = { ...external.wallet, refId: "p2" };
    await expect(wallets.attachCircleWallet(db, { projectId: "p2", userId: "u2", circleWalletId: "someone-else" })).rejects.toThrow(/already belongs/);
  });
});
