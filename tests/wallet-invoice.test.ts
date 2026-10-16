import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "44".repeat(32);
const BILLING = "0x2222222222222222222222222222222222222222";
const WALLET = "0x1111111111111111111111111111111111111111";
process.env.BILLING_ARC_ADDRESS = BILLING;
const arc = vi.hoisted(() => ({ sent: [] as { to: string; amount: string }[], paid: false, amountMicro: 0, hash: `0x${"f".repeat(64)}` }));

vi.mock("@/server/integrations/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({
  appKitSend: async (_wallet: unknown, payment: { to: string; amount: string }) => {
    arc.sent.push(payment);
    return { state: "success", txHash: arc.hash, explorerUrl: null, steps: [] };
  },
}));
vi.mock("@/server/domain/billing/arc", async (original) => ({
  ...(await original<typeof import("@/server/domain/billing/arc")>()),
  currentBlock: async () => 1_000n,
  transfersTo: async () => [],
  payoutInTx: async () => ({ status: "success", toRecipientMicro: arc.amountMicro, elsewhere: [], blockNumber: 1_001n }),
  paymentInTx: async () => arc.paid ? { from: WALLET, amountMicro: arc.amountMicro, blockNumber: 1_001n } : null,
}));

let db: DB;
let billing: typeof import("@/server/domain/billing");
let wallet: typeof import("@/server/domain/agent/withdraw");

beforeAll(async () => {
  const { getDb, schema } = await import("@/server/db/client");
  db = await getDb();
  billing = await import("@/server/domain/billing");
  wallet = await import("@/server/domain/agent/withdraw");
  await db.insert(schema.users).values({ id: "owner", email: "owner@example.test", name: "Owner", passwordHash: "x", emailVerifiedAt: new Date() });
  await db.insert(schema.projects).values({ id: "project", ownerId: "owner", name: "Shop", webhookSecret: "x" });
  await db.insert(schema.wallets).values({ id: "wallet", projectId: "project", provider: "circle_dcw", address: WALLET, circleWalletId: "cw", blockchain: "ARC", status: "ACTIVE", dataMode: "LIVE" });
});

describe("workspace wallet to scan credit", () => {
  it("requires the invoice amount plus gas reserve, then credits only the verified Arc payment once", async () => {
    const invoice = await billing.createInvoice(db, "owner", 2_000_000, { block: 1_000n });
    const amount = invoice.amountMicro / 1_000_000;
    await expect(wallet.checkWithdrawal(db, "project", { amount: String(amount), to: BILLING }, async () => 2_000_000)).rejects.toThrow(/network fee/);
    expect(await billing.balanceMicro(db, "owner")).toBe(0);

    arc.amountMicro = invoice.amountMicro;
    const sent = await wallet.withdraw(db, { projectId: "project", userId: "owner", amount: String(amount), to: BILLING, requestKey: `billing-invoice:${invoice.id}:code-1` }, async () => 2_100_000);
    expect(sent.state).toBe("SETTLED");
    expect(arc.sent).toHaveLength(1);
    expect(arc.sent[0].to).toBe(BILLING);
    expect(await billing.balanceMicro(db, "owner")).toBe(0);

    arc.paid = true;
    await expect(billing.payInvoiceWithTx(db, invoice, arc.hash, undefined, WALLET)).resolves.toEqual({ paid: true });
    expect(await billing.balanceMicro(db, "owner")).toBe(invoice.amountMicro);
    await billing.payInvoiceWithTx(db, invoice, arc.hash, undefined, WALLET);
    expect(await billing.balanceMicro(db, "owner")).toBe(invoice.amountMicro);
  });
});
