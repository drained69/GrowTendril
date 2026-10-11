import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";

/**
 * Controls that live outside the ledger: Arc as the independent witness for payouts and
 * top-ups, payee-change review, and paying the second tranche on delivery. The chain and
 * Circle are the only things faked; tests decide what Arc "shows".
 */
type Receipt = { status: "pending" | "success" | "reverted"; toRecipientMicro: number; elsewhere: { to: string; amountMicro: number }[]; blockNumber?: bigint };
const chain = vi.hoisted(() => ({
  block: 5_000n,
  receipts: new Map<string, Receipt>(),
  incoming: [] as { txHash: string; from: string; amountMicro: number; blockNumber: bigint }[],
  outgoing: [] as { txHash: string; from: string; to: string; amountMicro: number; blockNumber: bigint }[],
  txs: new Map<string, { amountMicro: number; from: string; blockNumber: bigint }>(),
  sends: [] as { to: string; amount: string; txHash: string }[],
  nextHash: 1,
}));
vi.mock("@/server/domain/billing/arc", async (orig) => {
  const real = await orig<typeof import("@/server/domain/billing/arc")>();
  return {
    ...real,
    currentBlock: async () => chain.block,
    transfersTo: async (_to: string, from: bigint, to?: bigint) => chain.incoming.filter((t) => t.blockNumber >= from && t.blockNumber <= (to ?? chain.block)),
    transfersFrom: async (_from: string, from: bigint, to: bigint) => chain.outgoing.filter((t) => t.blockNumber >= from && t.blockNumber <= to),
    payoutInTx: async (hash: string) => chain.receipts.get(hash) ?? { status: "pending", toRecipientMicro: 0, elsewhere: [] },
    paymentInTx: async (hash: string) => chain.txs.get(hash) ?? null,
  };
});
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({
  appKitSend: async (_w: unknown, p: { to: string; amount: string }) => {
    const txHash = `0x${(chain.nextHash++).toString(16).padStart(64, "0")}`;
    chain.sends.push({ to: p.to, amount: p.amount, txHash });
    return { state: "success", txHash, explorerUrl: null, steps: [{ name: "send", state: "success" }] };
  },
  appKitBridge: async () => {
    throw new Error("not used");
  },
}));

let db: DB;
let s: typeof import("@/server/db/schema");
let x: typeof import("@/server/domain/growth/experiments");
let exec: typeof import("@/server/domain/agent/execute");
let wallet: typeof import("@/server/domain/reconcile/wallet");
let billing: typeof import("@/server/domain/billing");
let recon: typeof import("@/server/domain/reconcile/billing");
let helpers: typeof import("@/server/db/helpers");
let missionId: string;

const WALLET = "0x1111111111111111111111111111111111111111";
const WRITER = "0x000000000000000000000000000000000000bEEF";
const SWAPPED = "0x000000000000000000000000000000000000dEaD".replace("dEaD", "c0de");
const PAY_TO = "0x2222222222222222222222222222222222222222";
const usdc = (n: number) => Math.round(n * 1_000_000);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  x = await import("@/server/domain/growth/experiments");
  exec = await import("@/server/domain/agent/execute");
  wallet = await import("@/server/domain/reconcile/wallet");
  billing = await import("@/server/domain/billing");
  recon = await import("@/server/domain/reconcile/billing");
  helpers = await import("@/server/db/helpers");
  const setup = await import("@/server/domain/workspace/setup");
  await db.insert(s.users).values([
    { id: "u1", email: "owner@example.test", name: "Owner", passwordHash: "x" },
    { id: "u2", email: "admin@example.test", name: "Admin", passwordHash: "x" },
  ]);
  await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Crumb Club", webhookSecret: "secret" });
  await setup.startMission(db, { projectId: "p1", templateKey: "first_customers", goal: 25, days: 30, budget: "300" });
  await setup.activateWorkspace(db, { projectId: "p1", rules: { dailySpend: "50", hardCeiling: "10", autonomousLimit: "2" }, autopilot: "off" });
  [{ id: missionId }] = await db.select({ id: s.missions.id }).from(s.missions).where(eq(s.missions.projectId, "p1"));
  await db.insert(s.wallets).values({ id: "w1", projectId: "p1", provider: "circle_dcw", address: WALLET, circleWalletId: "cw", blockchain: "ARC", status: "ACTIVE", dataMode: "LIVE" });
});

async function experiment(id: string, number: number, budget = 30) {
  await db.insert(s.experiments).values({
    id,
    projectId: "p1",
    missionId,
    number,
    title: `Commissioned post ${number}`,
    hypothesis: "A definitive post reaches people already searching.",
    channel: "content",
    budgetCategory: "content",
    target: "10 visits",
    action: "Commission one post",
    budgetMicro: usdc(budget),
    successEvent: "purchase",
    successTarget: 2,
    stopMaxCpaMicro: usdc(72),
    stopAfterSpendMicro: usdc(budget / 2),
    timeframeDays: 10,
    status: "proposed",
    recipientAddress: WRITER,
    recipientLabel: "Sam, writer",
    dataMode: "LIVE",
  });
}

const pending = () => db.select().from(s.approvals).where(and(eq(s.approvals.projectId, "p1"), eq(s.approvals.status, "pending")));
const txOf = async (id: string) => (await db.select().from(s.transactions).where(eq(s.transactions.id, id)))[0];
const exceptions = (kind?: string) => db.select().from(s.ledgerExceptions).where(kind ? eq(s.ledgerExceptions.kind, kind) : undefined);

/** Propose the next payment for an experiment and approve it as `userId`. Arc will show `arc` for it. */
async function payNext(expId: string, userId: string, arc: (txHash: string) => Receipt, tranche: "first" | "second" = "first") {
  const r = await x.launchExperiment(db, { projectId: "p1", experimentId: expId, tranche });
  expect(r.verdict).toBe("APPROVAL_REQUIRED");
  const ap = (await pending()).find((a) => a.decisionId === r.decisionId)!;
  const before = chain.nextHash;
  chain.receipts.set(hash(before), arc(hash(before)));
  const res = await exec.resolveApproval(db, { approvalId: ap.id, userId, resolution: "approve" });
  return { ap, res, tx: await txOf(ap.transactionId!) };
}

describe("payouts are settled only once Arc shows them", () => {
  beforeAll(() => experiment("exp-a", 1));

  it("marks a payout verified when the approved amount reached the approved address", async () => {
    const { res, tx } = await payNext("exp-a", "u1", () => ({ status: "success", toRecipientMicro: usdc(10), elsewhere: [], blockNumber: 4_900n }));
    expect(res.state).toBe("SETTLED");
    expect(tx).toMatchObject({ state: "SETTLED", chainCheck: "verified" });
    expect(await exceptions()).toHaveLength(0);
  });

  it("flags a payout where Arc shows a different amount, or money going elsewhere", async () => {
    const { tx } = await payNext("exp-a", "u1", () => ({ status: "success", toRecipientMicro: usdc(4), elsewhere: [{ to: SWAPPED, amountMicro: usdc(1) }], blockNumber: 4_901n }));
    expect(tx).toMatchObject({ state: "SETTLED", chainCheck: "mismatch" });
    const [e] = await exceptions("payout_mismatch");
    expect(e).toMatchObject({ scope: "wallet", projectId: "p1", transactionId: tx.id, status: "open" });
    expect(e.detail).toMatch(/Approved: 5(\.00)? USDC/);
    expect(e.detail).toMatch(/to 0x0000…c0de/);
  });

  it("keeps a payout in flight until it is mined, and fails it if it reverted", async () => {
    await experiment("exp-b", 2);
    const { tx } = await payNext("exp-b", "u1", () => ({ status: "pending", toRecipientMicro: 0, elsewhere: [] }));
    expect(tx.state).toBe("SUBMITTED");
    chain.receipts.set(tx.txHash!, { status: "reverted", toRecipientMicro: 0, elsewhere: [], blockNumber: 4_950n });
    await exec.refreshSettlements(db, "p1");
    expect((await txOf(tx.id)).state).toBe("FAILED");
    const [d] = await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.id, tx.decisionId));
    expect(d.status).toBe("failed");
  });
});

describe("every USDC leaving the agent wallet must be a recorded payment", () => {
  it("opens an exception for an unrecorded outflow, once, and checks recorded ones", async () => {
    const paid = chain.sends[0];
    chain.block = 6_000n;
    chain.outgoing.push(
      { txHash: paid.txHash, from: WALLET, to: WRITER, amountMicro: usdc(10), blockNumber: 4_900n },
      { txHash: hash(999), from: WALLET, to: SWAPPED, amountMicro: usdc(3), blockNumber: 5_500n },
    );
    const r = await wallet.reconcileWalletOutflows(db, "p1");
    expect(r).toMatchObject({ opened: 1 });
    const [e] = await exceptions("unrecorded_outflow");
    expect(e).toMatchObject({ ref: hash(999), amountMicro: usdc(3), status: "open" });
    // The cursor moved on: the next run reads only new blocks and opens nothing twice.
    expect(await wallet.reconcileWalletOutflows(db, "p1")).toMatchObject({ scanned: 0 });
    chain.block = 6_100n;
    expect(await wallet.reconcileWalletOutflows(db, "p1")).toMatchObject({ opened: 0 });
  });
});

describe("payee changes", () => {
  beforeAll(() => experiment("exp-c", 3));

  it("won't let the person who just replaced an address also approve paying it", async () => {
    await db.update(s.experiments).set({ recipientAddress: SWAPPED }).where(eq(s.experiments.id, "exp-c"));
    await helpers.audit(db, { projectId: "p1", actorType: "user", actorId: "u1", action: "experiment.recipient", target: "exp-c", data: { from: WRITER, to: SWAPPED } });
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: "exp-c" });
    const ap = (await pending()).find((a) => a.decisionId === r.decisionId)!;
    await expect(exec.resolveApproval(db, { approvalId: ap.id, userId: "u1", resolution: "approve" })).rejects.toThrow(/someone else with approval rights/);
    expect((await txOf(ap.transactionId!)).state).toBe("AWAITING_APPROVAL");
    // A second person can approve it.
    chain.receipts.set(hash(chain.nextHash), { status: "success", toRecipientMicro: usdc(10), elsewhere: [], blockNumber: 6_050n });
    const res = await exec.resolveApproval(db, { approvalId: ap.id, userId: "u2", resolution: "approve" });
    expect(res.state).toBe("SETTLED");
  });

  it("refuses to approve a payment whose address changed after it was proposed", async () => {
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: "exp-a", tranche: "first" }).catch((e: Error) => e);
    // exp-a's first tranche is fully paid; use a fresh experiment.
    expect(r).toBeInstanceOf(Error);
    await experiment("exp-d", 4);
    const p = await x.launchExperiment(db, { projectId: "p1", experimentId: "exp-d" });
    await db.update(s.experiments).set({ recipientAddress: SWAPPED }).where(eq(s.experiments.id, "exp-d"));
    const ap = (await pending()).find((a) => a.decisionId === p.decisionId)!;
    await expect(exec.resolveApproval(db, { approvalId: ap.id, userId: "u2", resolution: "approve" })).rejects.toThrow(/changed after the payment was proposed/);
    // Rejecting still works.
    expect((await exec.resolveApproval(db, { approvalId: ap.id, userId: "u2", resolution: "reject" })).status).toBe("rejected");
  });

  it("shows the approver whether the address was paid before and who set it", async () => {
    const payees = await import("@/server/domain/agent/payees");
    const ctx = await payees.payeeContext(db, "p1", SWAPPED.toUpperCase().replace("0X", "0x"));
    expect(ctx.firstPayment).toBe(false);
    expect(ctx.setBy).toMatchObject({ userId: "u1", replaced: WRITER });
    expect(payees.payeeHold(ctx, "u2")).toBeNull();
    expect(payees.payeeHold(ctx, "u1", ctx.setBy!.at.getTime() + payees.PAYEE_HOLD_MS + 1)).toBeNull();
    const fresh = await payees.payeeContext(db, "p1", "0x3333333333333333333333333333333333333333");
    expect(fresh).toMatchObject({ firstPayment: true, setBy: null });
  });
});

describe("the second tranche pays on delivery", () => {
  it("refuses tranche 2 until the delivered work is on record, then shows it to the approver", async () => {
    // exp-a: tranche 1 (10 USDC) is fully committed.
    await expect(x.launchExperiment(db, { projectId: "p1", experimentId: "exp-a", tranche: "second" })).rejects.toThrow(/pays on delivery/);
    await expect(x.recordDelivery(db, { projectId: "p1", experimentId: "exp-a", userId: "u1", url: "not a link" })).rejects.toThrow(/full link/);
    await x.recordDelivery(db, { projectId: "p1", experimentId: "exp-a", userId: "u1", url: "https://example.test/posts/definitive-guide", note: "Live Tuesday" });
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: "exp-a", tranche: "second" });
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    const ap = (await pending()).find((a) => a.decisionId === r.decisionId)!;
    const d = ap.details as { tranche?: string; delivery?: { url: string; recordedBy: string; visits: number } };
    expect(d.tranche).toBe("second");
    expect(d.delivery).toMatchObject({ url: "https://example.test/posts/definitive-guide", recordedBy: "Owner", visits: 0 });
    const [log] = await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "experiment.delivery"));
    expect(log.data).toMatchObject({ to: "https://example.test/posts/definitive-guide" });
  });

  it("only records delivery for a running experiment", async () => {
    await experiment("exp-e", 5);
    await expect(x.recordDelivery(db, { projectId: "p1", experimentId: "exp-e", userId: "u1", url: "https://example.test/x" })).rejects.toThrow(/once the experiment is running/);
  });
});

describe("every USDC reaching the billing address must belong to an invoice", () => {
  beforeEach(() => {
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
  });

  it("opens an exception for a payment that matched no invoice, and closes it when the payer claims it", async () => {
    chain.block = 7_000n;
    const inv = await billing.createInvoice(db, "u1", usdc(20), { block: 7_000n });
    // The payer rounds: 20 instead of the exact amount, so automatic matching can't claim it.
    chain.block = 7_010n;
    chain.incoming.push({ txHash: hash(500), from: "0x4444444444444444444444444444444444444444", amountMicro: usdc(20), blockNumber: 7_005n });
    // An exact payment for the open invoice is not an exception: the invoice claims it.
    const r = await recon.reconcileBillingPayments(db);
    expect(r).toMatchObject({ opened: 1 });
    const [e] = await exceptions("unmatched_payment");
    expect(e).toMatchObject({ scope: "billing", ref: hash(500), amountMicro: usdc(20), status: "open" });
    expect(e.detail).toMatch(/close to a pending 20(\.00)? USDC top-up for owner@example.test/);
    // Running again opens nothing new.
    expect(await recon.reconcileBillingPayments(db)).toMatchObject({ opened: 0 });

    chain.txs.set(hash(500), { amountMicro: usdc(20), from: "0x4444444444444444444444444444444444444444", blockNumber: 7_005n });
    await billing.payInvoiceWithTx(db, inv, hash(500));
    const [closed] = await exceptions("unmatched_payment");
    expect(closed).toMatchObject({ status: "resolved", resolvedBy: "system" });
    expect(closed.resolution).toContain(inv.id);
  });

  it("doesn't flag the exact payment for an open invoice", async () => {
    const inv = await billing.createInvoice(db, "u2", usdc(5), { block: 7_100n });
    chain.block = 7_120n;
    chain.incoming.push({ txHash: hash(501), from: "0x5555555555555555555555555555555555555555", amountMicro: inv.amountMicro, blockNumber: 7_110n });
    expect(await recon.reconcileBillingPayments(db)).toMatchObject({ opened: 0 });
    const [paid] = await db.select().from(s.billingInvoices).where(eq(s.billingInvoices.id, inv.id));
    expect(paid.status).toBe("paid");
  });
});
