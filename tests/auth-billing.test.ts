import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";

// The chain is the only thing faked: tests decide which USDC transfers "arrived" on Arc.
const chain = vi.hoisted(() => ({ block: 1_000n, transfers: [] as { txHash: string; from: string; amountMicro: number; blockNumber: bigint }[], txs: new Map<string, { amountMicro: number; from: string; blockNumber: bigint }>() }));
vi.mock("@/server/domain/billing/arc", async (orig) => {
  const real = await orig<typeof import("@/server/domain/billing/arc")>();
  return {
    ...real,
    currentBlock: async () => chain.block,
    transfersTo: async (_to: string, fromBlock: bigint) => chain.transfers.filter((t) => t.blockNumber >= fromBlock),
    paymentInTx: async (hash: string) => chain.txs.get(hash) ?? null,
  };
});

let db: DB;
let s: typeof import("@/server/db/schema");
let codes: typeof import("@/server/domain/auth/codes");
let billing: typeof import("@/server/domain/billing");
let email: typeof import("@/server/integrations/email");

/** The dev email fallback prints messages; read the code a person would have received. */
const sentCodes: string[] = [];
vi.spyOn(console, "info").mockImplementation((msg: string) => {
  const m = String(msg).match(/\b(\d{6})\b is your GrowTendril/);
  if (m) sentCodes.push(m[1]);
});

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  codes = await import("@/server/domain/auth/codes");
  billing = await import("@/server/domain/billing");
  email = await import("@/server/integrations/email");
  await db.insert(s.users).values([
    { id: "u1", email: "ada@example.test", name: "Ada Lovelace", passwordHash: "x" },
    { id: "u2", email: "bob@example.test", name: "Bob", passwordHash: "x" },
  ]);
  await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Crumb Club", webhookSecret: "secret" });
});

const PAY_TO = "0x1234567890abcdef1234567890abcdef12345678";
afterEach(() => {
  delete process.env.BILLING_DEV;
  delete process.env.BILLING_ARC_ADDRESS;
});

const ada = { id: "u1", email: "ada@example.test", name: "Ada Lovelace" };

describe("email verification codes", () => {
  it("emails a 6-digit code and accepts it once", async () => {
    const t0 = Date.UTC(2026, 0, 1);
    await codes.issueCode(db, ada, "verify", t0);
    const code = sentCodes.at(-1)!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(codes.consumeCode(db, "u1", "verify", wrong, t0 + 1000)).rejects.toThrow(/4 attempts left/);
    await codes.consumeCode(db, "u1", "verify", code, t0 + 2000);
    await expect(codes.consumeCode(db, "u1", "verify", code, t0 + 3000)).rejects.toThrow(/No active code/);
    const logged = await db.select().from(s.emailLog).where(and(eq(s.emailLog.userId, "u1"), eq(s.emailLog.kind, "verify_code")));
    expect(logged[0]).toMatchObject({ to: "ada@example.test", status: "logged" });
    expect(logged[0].subject).not.toContain(code);
    // Only a hash is stored, never the code.
    const [row] = await db.select().from(s.emailCodes).where(eq(s.emailCodes.userId, "u1"));
    expect(row.codeHash).not.toContain(code);
  });

  it("rate-limits resends, expires codes and locks after five wrong guesses", async () => {
    const t0 = Date.UTC(2026, 0, 2);
    await codes.issueCode(db, ada, "reset", t0);
    await expect(codes.issueCode(db, ada, "reset", t0 + 10_000)).rejects.toThrow(/new one in 50s/);
    await expect(codes.consumeCode(db, "u1", "reset", sentCodes.at(-1)!, t0 + 11 * 60_000)).rejects.toThrow(/expired/);

    await codes.issueCode(db, ada, "reset", t0 + 61_000);
    const real = sentCodes.at(-1)!;
    const wrong = real === "999999" ? "888888" : "999999";
    for (let i = 0; i < 4; i++) await expect(codes.consumeCode(db, "u1", "reset", wrong, t0 + 62_000)).rejects.toThrow(/attempt/);
    await expect(codes.consumeCode(db, "u1", "reset", wrong, t0 + 62_000)).rejects.toThrow(/Too many wrong attempts/);
    await expect(codes.consumeCode(db, "u1", "reset", real, t0 + 63_000)).rejects.toThrow(/No active code/);
  });

  it("refuses to pretend in production when no email provider is configured", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await expect(email.sendEmail(db, { to: "x@example.test", subject: "Hi", text: "Hi", kind: "welcome" })).rejects.toThrow(/isn't configured/);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it("escapes HTML in emails", () => {
    expect(email.renderHtml({ subject: "x", text: 'Hi <script>alert("x")</script>' })).not.toContain("<script>");
  });
});

describe("prepaid credit in USDC on Arc", () => {
  const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  const usdc = (n: number) => n * 1_000_000;

  it("charges nothing until billing is configured", async () => {
    expect(billing.billingMode()).toBe("off");
    expect(await billing.canAfford(db, "u1", "scan")).toBe(true);
    expect(await billing.chargeService(db, { ownerId: "u1", service: "scan", ref: "off-1" })).toEqual({ charged: false, balanceMicro: 0 });
    process.env.BILLING_DEV = "1";
    expect(billing.billingMode()).toBe("dev");
    expect(await billing.canAfford(db, "u1", "scan")).toBe(false);
    process.env.BILLING_ARC_ADDRESS = "not-an-address";
    expect(billing.billingMode()).toBe("dev");
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
    expect(billing.billingMode()).toBe("arc");
  });

  it("accepts top-ups from the minimum, in cents", () => {
    expect(billing.parseTopUp("2")).toBe(usdc(2));
    expect(billing.parseTopUp(12.5)).toBe(12_500_000);
    expect(() => billing.parseTopUp("1.99")).toThrow(/at least 2 USDC/);
    expect(() => billing.parseTopUp("5.001")).toThrow(/two decimal/);
    // Cent amounts that float math gets wrong (19.99 × 100 = 1998.9999…) are valid.
    for (const v of ["19.99", "20.01", "4.35", "1,000.29", "7.50", "3.000"]) expect(() => billing.parseTopUp(v)).not.toThrow();
    expect(billing.parseTopUp("19.99")).toBe(19_990_000);
    expect(billing.parseTopUp(4.35)).toBe(4_350_000);
    expect(() => billing.parseTopUp("10001")).toThrow(/at most/);
    expect(() => billing.parseTopUp("abc")).toThrow(/at least/);
  });

  it("gives each open top-up its own exact amount and reuses an open one", async () => {
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
    const a = await billing.createInvoice(db, "u1", usdc(10));
    const b = await billing.createInvoice(db, "u2", usdc(10));
    expect(a.amountMicro).toBeGreaterThan(usdc(10));
    expect(a.amountMicro).toBeLessThan(usdc(10) + 10_000);
    expect(b.amountMicro).not.toBe(a.amountMicro);
    expect(a.payTo).toBe(PAY_TO);
    expect(a.plan).toBe(billing.TOPUP);
    expect((await billing.createInvoice(db, "u1", usdc(10))).id).toBe(a.id);
    expect((await billing.createInvoice(db, "u1", usdc(25))).id).not.toBe(a.id);
  });

  it("credits the balance when the exact amount arrives on Arc, and emails a receipt", async () => {
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
    const inv = await billing.createInvoice(db, "u1", usdc(10));
    expect((await billing.checkInvoice(db, inv)).paid).toBe(false);
    // Someone else's payment of a different amount doesn't count.
    chain.transfers.push({ txHash: hash(1), from: "0xpayer", amountMicro: inv.amountMicro + 1, blockNumber: 1_001n });
    expect((await billing.checkInvoice(db, inv)).paid).toBe(false);
    chain.transfers.push({ txHash: hash(2), from: "0xpayer", amountMicro: inv.amountMicro, blockNumber: 1_002n });
    expect((await billing.checkInvoice(db, inv)).paid).toBe(true);
    expect(await billing.balanceMicro(db, "u1")).toBe(inv.amountMicro);
    // Checking again never credits twice.
    const [again] = await db.select().from(s.billingInvoices).where(eq(s.billingInvoices.id, inv.id));
    expect((await billing.checkInvoice(db, again)).paid).toBe(true);
    expect(await billing.balanceMicro(db, "u1")).toBe(inv.amountMicro);
    const mail = await db.select().from(s.emailLog).where(and(eq(s.emailLog.userId, "u1"), eq(s.emailLog.kind, "credit_added")));
    expect(mail.at(-1)?.subject).toMatch(/added to your GrowTendril balance/);
  });

  it("checks a pasted transaction hash: right address, after the invoice, at least the top-up, used once", async () => {
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
    chain.block = 2_000n;
    const before = await billing.balanceMicro(db, "u1");
    const inv = await billing.createInvoice(db, "u1", usdc(5));
    chain.txs.set(hash(10), { amountMicro: usdc(5), from: "0xpayer", blockNumber: 1_500n });
    await expect(billing.payInvoiceWithTx(db, inv, hash(10))).rejects.toThrow(/before this invoice/);
    chain.txs.set(hash(11), { amountMicro: usdc(3), from: "0xpayer", blockNumber: 2_001n });
    await expect(billing.payInvoiceWithTx(db, inv, hash(11))).rejects.toThrow(/sent 3.00 USDC; this top-up is 5.00 USDC/);
    await expect(billing.payInvoiceWithTx(db, inv, hash(99))).rejects.toThrow(/can't find/);
    await expect(billing.payInvoiceWithTx(db, inv, "0x123")).rejects.toThrow(/doesn't look like/);
    // Sending more than asked credits all of it, even without the matching suffix.
    chain.txs.set(hash(12), { amountMicro: usdc(7), from: "0xpayer", blockNumber: 2_002n });
    expect((await billing.payInvoiceWithTx(db, inv, hash(12))).paid).toBe(true);
    expect(await billing.balanceMicro(db, "u1")).toBe(before + usdc(7));
    // The same transaction can't pay a second invoice.
    const other = await billing.createInvoice(db, "u2", usdc(5));
    await expect(billing.payInvoiceWithTx(db, other, hash(12))).rejects.toThrow(/already paid another invoice/);
    chain.transfers.push({ txHash: hash(12), from: "0xpayer", amountMicro: other.amountMicro, blockNumber: 2_003n });
    expect((await billing.checkInvoice(db, other)).paid).toBe(false);
  });

  it("charges each service its fixed price once, never overdraws, and refunds failures", async () => {
    process.env.BILLING_ARC_ADDRESS = PAY_TO;
    await billing.addCredit(db, { userId: "u2", amountMicro: usdc(5), ref: "test-topup-u2" });
    expect(await billing.balanceMicro(db, "u2")).toBe(usdc(5));
    expect(await billing.chargeService(db, { ownerId: "u2", projectId: "p1", service: "scan", ref: "job:a" })).toEqual({ charged: true, balanceMicro: usdc(3) });
    // The same ref (a retried request) is charged once.
    expect((await billing.chargeService(db, { ownerId: "u2", service: "scan", ref: "job:a" })).charged).toBe(false);
    expect(await billing.balanceMicro(db, "u2")).toBe(usdc(3));
    // Two services started together can't both spend the last 3 USDC.
    const both = await Promise.allSettled([
      billing.chargeService(db, { ownerId: "u2", service: "creator_report", ref: "r:1" }),
      billing.chargeService(db, { ownerId: "u2", service: "creator_report", ref: "r:2" }),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(billing.InsufficientCredit);
    expect(await billing.balanceMicro(db, "u2")).toBe(0);
    expect(await billing.canAfford(db, "u2", "scan")).toBe(false);
    // A failed service is refunded once.
    expect(await billing.refundCharge(db, "job:a")).toBe(true);
    expect(await billing.refundCharge(db, "job:a")).toBe(false);
    expect(await billing.refundCharge(db, "never-charged")).toBe(false);
    expect(await billing.balanceMicro(db, "u2")).toBe(usdc(2));
    const kinds = (await billing.ledgerFor(db, "u2")).map((l) => l.kind).sort();
    expect(kinds).toEqual(["charge", "charge", "refund", "topup"]);
  });
});

describe("browser wallet payment", () => {
  it("asks the wallet for exactly the right USDC transfer", async () => {
    const { encodeFunctionData, erc20Abi } = await import("viem");
    const { transferCalldata } = await import("@/lib/erc20");
    const to = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
    expect(transferCalldata(to, 29_006_920)).toBe(encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 29_006_920n] }));
  });
});

describe("Google sign-in", () => {
  const token = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
  const ok = { iss: "https://accounts.google.com", aud: "client-1", exp: 2_000_000_000, sub: "g-123", email: "Ada@Gmail.com", email_verified: true, name: "Ada" };

  it("accepts a verified Gmail identity for this app only", async () => {
    const g = await import("@/server/auth/google");
    expect(g.identityFromIdToken(token(ok), "client-1", 1_900_000_000)).toEqual({ sub: "g-123", email: "ada@gmail.com", name: "Ada" });
    expect(() => g.identityFromIdToken(token({ ...ok, aud: "other" }), "client-1", 1_900_000_000)).toThrow(/different app/);
    expect(() => g.identityFromIdToken(token({ ...ok, email_verified: false }), "client-1", 1_900_000_000)).toThrow(/isn't verified/);
    expect(() => g.identityFromIdToken(token(ok), "client-1", 2_100_000_000)).toThrow(/expired/);
  });

  it("signs the OAuth state so it can't be forged", async () => {
    const g = await import("@/server/auth/google");
    const packed = g.packState(g.newOAuthState("/app", null));
    expect(g.unpackState(packed)?.next).toBe("/app");
    const [body, sig] = packed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), next: "/evil" })).toString("base64url");
    expect(g.unpackState(`${forged}.${sig}`)).toBeNull();
  });
});

describe("sessions", () => {
  it("carry the account's session version so a reset can revoke them", async () => {
    const sess = await import("@/server/auth/session");
    expect(sess.verifySessionToken(sess.createSessionToken("u1", 3))).toEqual({ uid: "u1", v: 3 });
    expect(sess.verifySessionToken(sess.createSessionToken("u1"))).toEqual({ uid: "u1", v: 0 });
    expect(sess.verifySessionToken("tampered.token")).toBeNull();
  });
});
