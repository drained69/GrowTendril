import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "44".repeat(32);
const ext = vi.hoisted(() => ({ sends: [] as { to: string; amount: string }[], balanceMicro: 20_000_000, sendFails: false, emails: [] as { kind: string; text: string; subject: string }[] }));
vi.mock("@/server/integrations/email", () => ({ sendEmail: vi.fn(async (_db: unknown, m: { kind: string; text: string; subject: string }) => { ext.emails.push(m); return { delivered: false, mode: "console" }; }) }));
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({
  appKitSend: async (_w: unknown, p: { to: string; amount: string }) => {
    if (ext.sendFails) throw new Error("Circle unavailable");
    ext.sends.push(p);
    return { state: "success", txHash: `0x${ext.sends.length.toString(16).padStart(64, "a")}`, explorerUrl: null, steps: [] };
  },
}));
vi.mock("@/server/domain/billing/arc", async (original) => ({
  ...(await original<typeof import("@/server/domain/billing/arc")>()),
  currentBlock: async () => 1000n,
  // Arc shows the withdrawal's full amount reaching the destination.
  payoutInTx: async () => ({ status: "success", toRecipientMicro: ext.sends.length ? Math.round(Number(ext.sends[ext.sends.length - 1].amount) * 1e6) : 0, elsewhere: [], blockNumber: 1001n }),
}));

let db: DB;
let s: typeof import("@/server/db/schema");
let wd: typeof import("@/server/domain/agent/withdraw");
let codes: typeof import("@/server/domain/auth/codes");
const WALLET = "0x1111111111111111111111111111111111111111";
const DEST = "0x2222222222222222222222222222222222222222";
const balance = async () => ext.balanceMicro;

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  wd = await import("@/server/domain/agent/withdraw");
  codes = await import("@/server/domain/auth/codes");
  await db.insert(s.users).values({ id: "owner", email: "owner@example.test", name: "Owner One", passwordHash: "x", emailVerifiedAt: new Date() });
  await db.insert(s.projects).values({ id: "p", ownerId: "owner", name: "Shop", webhookSecret: "x" });
  await db.insert(s.wallets).values({ id: "w", projectId: "p", provider: "circle_dcw", address: WALLET, circleWalletId: "cw", blockchain: "ARC", status: "ACTIVE", dataMode: "LIVE" });
});
afterEach(() => {
  ext.sends = [];
  ext.balanceMicro = 20_000_000;
  ext.sendFails = false;
  ext.emails = [];
});

describe("owner withdrawal", () => {
  it("keeps Arc's fee reserve and in-flight payments out of what can be withdrawn", async () => {
    expect((await wd.withdrawable(db, "p", balance)).availableMicro).toBe(20_000_000 - wd.GAS_RESERVE_MICRO);
    await expect(wd.checkWithdrawal(db, "p", { amount: "20", to: DEST }, balance)).rejects.toThrow(/up to 19\.95/);
    await expect(wd.checkWithdrawal(db, "p", { amount: "5", to: WALLET }, balance)).rejects.toThrow(/own address/);
    await expect(wd.checkWithdrawal(db, "p", { amount: "5", to: "0x123" }, balance)).rejects.toThrow(/Arc \(EVM\) address/);
    await expect(wd.checkWithdrawal(db, "p", { amount: "0.001", to: DEST }, balance)).rejects.toThrow(/at least/);
  });

  it("sends, records a treasury transaction that is checked on Arc, and emails the owner", async () => {
    const r = await wd.withdraw(db, { projectId: "p", userId: "owner", amount: "12.5", to: DEST, requestKey: "code-1" }, balance);
    expect(r).toMatchObject({ state: "SETTLED", amountMicro: 12_500_000, to: DEST, duplicate: false });
    expect(ext.sends).toEqual([{ chain: "Arc", to: DEST, amount: "12.5" }]);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, "withdraw:p:code-1"));
    expect(tx).toMatchObject({ state: "SETTLED", budgetCategory: "treasury", recipient: DEST, chainCheck: "verified" });
    const [receipt] = await db.select().from(s.decisionReceipts).where(eq(s.decisionReceipts.decisionId, tx.decisionId));
    expect(receipt).toBeTruthy();
    expect(ext.emails.map((e) => e.kind)).toEqual(["withdrawal"]);
  });

  it("treats a retried request as the same withdrawal, never a second send", async () => {
    const again = await wd.withdraw(db, { projectId: "p", userId: "owner", amount: "12.5", to: DEST, requestKey: "code-1" }, balance);
    expect(again.duplicate).toBe(true);
    expect(ext.sends).toHaveLength(0);
  });

  it("marks a send that never reached Circle as failed and moves nothing", async () => {
    ext.sendFails = true;
    const r = await wd.withdraw(db, { projectId: "p", userId: "owner", amount: "1", to: DEST, requestKey: "code-2" }, balance);
    expect(r.state).toBe("FAILED");
    expect(ext.emails).toHaveLength(0);
  });

  it("refuses while the wallet is frozen", async () => {
    await db.update(s.wallets).set({ frozen: true }).where(eq(s.wallets.id, "w"));
    await expect(wd.checkWithdrawal(db, "p", { amount: "1", to: DEST }, balance)).rejects.toThrow(/frozen/);
    await db.update(s.wallets).set({ frozen: false }).where(eq(s.wallets.id, "w"));
  });

  it("binds the emailed code to the exact amount and destination", async () => {
    const owner = { id: "owner", email: "owner@example.test", name: "Owner One" };
    const scope = wd.withdrawalScope("p", 3_000_000, DEST);
    await codes.issueCode(db, owner, "withdraw", Date.now(), { scope, summary: "3.00 USDC" });
    const code = ext.emails.at(-1)!.text.match(/\b(\d{6})\b/)![1];
    expect(ext.emails.at(-1)!.kind).toBe("withdraw_code");
    // The same code for a different destination is wrong (and costs an attempt).
    await expect(codes.consumeCode(db, "owner", "withdraw", code, Date.now(), wd.withdrawalScope("p", 3_000_000, "0x3333333333333333333333333333333333333333"))).rejects.toThrow(/isn't right/);
    const id = await codes.consumeCode(db, "owner", "withdraw", code, Date.now(), scope);
    expect(id).toBeTruthy();
  });

  it("never counts a withdrawal against agent spend limits", async () => {
    const { spentToday } = await import("@/server/domain/agent/ledger");
    expect(await spentToday(db, "p")).toBe(0);
  });
});
