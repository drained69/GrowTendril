import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
const PAY_TO = "0x1111111111111111111111111111111111111111";
process.env.BILLING_ARC_ADDRESS = PAY_TO;
const chain = vi.hoisted(() => ({ payment: null as null | { from: string; amountMicro: number; blockNumber: bigint } }));
vi.mock("@/server/integrations/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/server/domain/billing/arc", async (original) => ({
  ...(await original<typeof import("@/server/domain/billing/arc")>()),
  currentBlock: async () => 1000n,
  transfersTo: async () => [],
  paymentInTx: async () => chain.payment,
}));

let db: DB;
let billing: typeof import("@/server/domain/billing");
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  billing = await import("@/server/domain/billing");
  await db.insert(client.schema.users).values([
    { id: "alice", email: "alice@example.test", name: "Alice", passwordHash: "x" },
    { id: "bob", email: "bob@example.test", name: "Bob", passwordHash: "x" },
  ]);
});

describe("claiming a top-up by transaction hash", () => {
  it("won't let someone take another person's exact-amount payment before it is matched", async () => {
    const alice = await billing.createInvoice(db, "alice", 10_000_000, { block: 900n });
    const bob = await billing.createInvoice(db, "bob", 5_000_000, { block: 900n });
    // Alice paid her exact invoice amount; Bob saw the hash and pastes it into his own invoice.
    chain.payment = { from: "0x9999999999999999999999999999999999999999", amountMicro: alice.amountMicro, blockNumber: 950n };
    await expect(billing.payInvoiceWithTx(db, bob, HASH_A)).rejects.toThrow(/matches another top-up request/);
    // Alice can still claim it.
    await expect(billing.payInvoiceWithTx(db, alice, HASH_A)).resolves.toEqual({ paid: true });
    expect(await billing.balanceMicro(db, "alice")).toBe(alice.amountMicro);
    expect(await billing.balanceMicro(db, "bob")).toBe(0);
  });

  it("still accepts a rounded payment that matches nobody else's invoice", async () => {
    const carol = await billing.createInvoice(db, "bob", 2_000_000, { block: 900n });
    chain.payment = { from: "0x9999999999999999999999999999999999999999", amountMicro: 2_000_000, blockNumber: 960n };
    await expect(billing.payInvoiceWithTx(db, carol, HASH_C)).resolves.toEqual({ paid: true });
  });
});
