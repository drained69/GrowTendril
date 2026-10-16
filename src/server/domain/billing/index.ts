import { randomInt } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { sendEmail } from "@/server/integrations/email";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { MAX_TOPUP_USDC, MIN_TOPUP_USDC, SERVICES, servicePriceMicro, type ServiceKey } from "@/lib/services";
import { currentBlock, isAddress, isTxHash, paymentInTx, transfersTo } from "@/server/domain/billing/arc";
import { resolveByRef } from "@/server/domain/reconcile/exceptions";

/**
 * Billing, paid in USDC on Arc, as a prepaid balance. The account that owns a workspace tops up
 * any amount; each service (see lib/services.ts) deducts its fixed price from that balance when
 * it runs, whoever on the team starts it. A top-up is an invoice for an exact amount: GrowTendril
 * sees the transfer arrive on Arc (or checks the transaction hash the payer gives) and credits it.
 *
 *   arc → BILLING_ARC_ADDRESS is set: services cost credit, top-ups are paid to that Arc address.
 *   dev → development only, BILLING_DEV=1: services cost credit; "Top up" credits it for free.
 *   off → neither: every service is free.
 */

export type BillingMode = "arc" | "dev" | "off";

export const INVOICE_TTL_MS = 2 * 3_600_000;
/** Invoices for top-ups carry this in their `plan` column. */
export const TOPUP = "topup";

export const payToAddress = () => {
  const a = process.env.BILLING_ARC_ADDRESS?.trim();
  return isAddress(a) ? a : null;
};

export function billingMode(): BillingMode {
  if (payToAddress()) return "arc";
  if (process.env.NODE_ENV !== "production" && process.env.BILLING_DEV === "1") return "dev";
  return "off";
}

/** "Label · 2 USDC" while billing is on, so paid buttons say what they cost. */
export function priced(label: string, service: ServiceKey): string {
  return billingMode() === "off" ? label : `${label} · ${SERVICES[service].priceUsdc} USDC`;
}

export class InsufficientCredit extends Error {
  constructor(
    readonly service: ServiceKey,
    readonly balanceMicro: number,
  ) {
    super(`${SERVICES[service].name} costs ${fmtUsdc(servicePriceMicro(service))} of prepaid credit; the workspace owner's credit balance is ${fmtUsdc(balanceMicro)}. The owner can pay a Billing invoice from the workspace wallet to fund the scan.`);
  }
}

// ───────────────────────────── balance ─────────────────────────────

export async function balanceMicro(db: DB, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<string>`coalesce(sum(${s.creditLedger.amountMicro}), 0)` }).from(s.creditLedger).where(eq(s.creditLedger.userId, userId));
  return Number(r?.n ?? 0);
}

export async function ledgerFor(db: DB, userId: string, limit = 50) {
  return db.select().from(s.creditLedger).where(eq(s.creditLedger.userId, userId)).orderBy(desc(s.creditLedger.createdAt)).limit(limit);
}

/** Would the owner's balance cover this service right now? Always true when billing is off. */
export async function canAfford(db: DB, ownerId: string, service: ServiceKey): Promise<boolean> {
  if (billingMode() === "off") return true;
  return (await balanceMicro(db, ownerId)) >= servicePriceMicro(service);
}

/**
 * Deduct a service's price from the owner's balance. `ref` identifies the use (a job id, say):
 * charging the same ref twice charges once. Serialised per account so two services started at
 * once can't spend the same credit. Throws InsufficientCredit when the balance is short.
 */
export async function chargeService(db: DB, v: { ownerId: string; projectId?: string | null; service: ServiceKey; ref: string; actorId?: string | null; note?: string }): Promise<{ charged: boolean; balanceMicro: number }> {
  if (billingMode() === "off") return { charged: false, balanceMicro: 0 };
  const price = servicePriceMicro(v.service);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit:${v.ownerId}`}))`);
    const [done] = await tx.select({ id: s.creditLedger.id }).from(s.creditLedger).where(and(eq(s.creditLedger.kind, "charge"), eq(s.creditLedger.ref, v.ref)));
    const balance = await balanceMicro(tx as unknown as DB, v.ownerId);
    if (done) return { charged: false, balanceMicro: balance };
    if (balance < price) throw new InsufficientCredit(v.service, balance);
    await tx.insert(s.creditLedger).values({ id: newId(), userId: v.ownerId, projectId: v.projectId ?? null, kind: "charge", service: v.service, amountMicro: -price, ref: v.ref, actorId: v.actorId ?? null, note: v.note ?? null });
    return { charged: true, balanceMicro: balance - price };
  });
}

/** Give back a charge whose service failed. Safe to call more than once, or for a ref never charged. */
export async function refundCharge(db: DB, ref: string, note = "Service failed — refunded"): Promise<boolean> {
  const [c] = await db.select().from(s.creditLedger).where(and(eq(s.creditLedger.kind, "charge"), eq(s.creditLedger.ref, ref)));
  if (!c) return false;
  const r = await db
    .insert(s.creditLedger)
    .values({ id: newId(), userId: c.userId, projectId: c.projectId, kind: "refund", service: c.service, amountMicro: -c.amountMicro, ref, note })
    .onConflictDoNothing()
    .returning({ id: s.creditLedger.id });
  return r.length > 0;
}

/** Add credit (a confirmed top-up, or the development stand-in for one). */
export async function addCredit(db: DB, v: { userId: string; amountMicro: number; ref: string; note?: string }) {
  if (!Number.isSafeInteger(v.amountMicro) || v.amountMicro <= 0) throw new Error("Credit must be a positive, safe integer amount of micro-USDC");
  const r = await db
    .insert(s.creditLedger)
    .values({ id: newId(), userId: v.userId, kind: "topup", amountMicro: v.amountMicro, ref: v.ref, note: v.note ?? null })
    .onConflictDoNothing()
    .returning({ id: s.creditLedger.id });
  return r.length > 0;
}

/** A top-up amount in whole cents. Parsed from the decimal text, never through float math (19.99 × 100 ≠ 1999). */
export function parseTopUp(usdc: unknown): number {
  const raw = (typeof usdc === "number" ? (Number.isFinite(usdc) ? String(usdc) : "") : String(usdc ?? "")).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Top up at least ${MIN_TOPUP_USDC} USDC.`);
  if (/\.\d{3,}$/.test(raw.replace(/0+$/, ""))) throw new Error("Use at most two decimal places.");
  const micro = toMicro(raw);
  if (micro < toMicro(MIN_TOPUP_USDC)) throw new Error(`Top up at least ${MIN_TOPUP_USDC} USDC.`);
  if (micro > toMicro(MAX_TOPUP_USDC)) throw new Error(`Top up at most ${MAX_TOPUP_USDC.toLocaleString("en-US")} USDC at a time.`);
  return micro;
}

async function receiptEmail(db: DB, userId: string, v: { amountMicro: number; txHash: string; chain: string; appUrl?: string }) {
  const [u] = await db.select({ email: s.users.email, name: s.users.name }).from(s.users).where(eq(s.users.id, userId));
  if (!u) return;
  const app = v.appUrl ?? process.env.APP_URL?.trim() ?? "";
  const balance = await balanceMicro(db, userId);
  await sendEmail(db, {
    to: u.email,
    userId,
    kind: "credit_added",
    subject: `Payment received — ${fmtUsdc(v.amountMicro)} added to your GrowTendril balance`,
    text: `Hi ${u.name.split(" ")[0] || "there"},\n\nThanks — ${fmtUsdc(v.amountMicro)} is now on your GrowTendril balance (${fmtUsdc(balance)} in total).\n\nReceipt: ${(v.amountMicro / 1e6).toFixed(6)} USDC on Arc\nTransaction: ${txExplorerUrl(v.chain, v.txHash)}`,
    action: app ? { label: "Open billing", url: `${app}/billing` } : undefined,
  }).catch((e) => console.warn(`[billing] receipt email failed: ${(e as Error).message}`));
}

/** Expire stale top-up invoices. Idempotent. */
export async function expireInvoices(db: DB, now = Date.now()) {
  await db.update(s.billingInvoices).set({ status: "expired" }).where(and(eq(s.billingInvoices.status, "pending"), lt(s.billingInvoices.expiresAt, new Date(now))));
}

// ───────────────────────────── invoices ─────────────────────────────

export type Invoice = typeof s.billingInvoices.$inferSelect;

export async function invoicesFor(db: DB, userId: string, limit = 12) {
  return db.select().from(s.billingInvoices).where(eq(s.billingInvoices.userId, userId)).orderBy(desc(s.billingInvoices.createdAt)).limit(limit);
}

/**
 * A top-up request. Reuses the person's open invoice for the same amount; otherwise picks an
 * exact amount (requested + 0.000001–0.009999 USDC) no other open invoice is using, so an
 * incoming transfer identifies its invoice. The full amount that arrives is credited.
 */
export async function createInvoice(db: DB, userId: string, requestedMicro: number, opts: { now?: number; block?: bigint } = {}): Promise<Invoice> {
  const plan = TOPUP;
  const now = opts.now ?? Date.now();
  const payTo = payToAddress();
  if (!payTo) throw new Error("USDC payments aren't set up on this deployment yet.");
  if (!Number.isSafeInteger(requestedMicro) || parseTopUp(microToDecimal(requestedMicro)) !== requestedMicro) throw new Error("Invalid top-up amount");
  // Read the chain before opening the transaction: an RPC outage must not hold database locks.
  const block = opts.block ?? (await currentBlock());
  return db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${payTo.toLowerCase()}`}))`);
  const db = tx as unknown as DB;
  const [open] = await db
    .select()
    .from(s.billingInvoices)
    .where(and(eq(s.billingInvoices.userId, userId), eq(s.billingInvoices.plan, plan), eq(s.billingInvoices.priceMicro, requestedMicro), eq(s.billingInvoices.status, "pending"), gt(s.billingInvoices.expiresAt, new Date(now + 20 * 60_000))));
  if (open) return open;
  const price = requestedMicro;
  const taken = new Set((await db.select({ a: s.billingInvoices.amountMicro }).from(s.billingInvoices).where(and(eq(s.billingInvoices.payTo, payTo), eq(s.billingInvoices.status, "pending"), gt(s.billingInvoices.expiresAt, new Date(now))))).map((r) => r.a));
  const start = randomInt(1, 10_000);
  let amount: number | undefined;
  for (let i = 0; i < 9_999; i++) {
    const candidate = price + ((start - 1 + i) % 9_999) + 1;
    if (!taken.has(candidate)) { amount = candidate; break; }
  }
  if (amount == null) throw new Error("All matching amounts are in use. Try this top-up again later.");
  // A few blocks of slack so a payment sent the moment the invoice appears still counts.
  const fromBlock = block > 20n ? block - 20n : 0n;
  const [inv] = await db
    .insert(s.billingInvoices)
    .values({ id: newId(), userId, plan, amountMicro: amount, priceMicro: price, payTo, fromBlock: fromBlock.toString(), createdAt: new Date(now), expiresAt: new Date(now + INVOICE_TTL_MS) })
    .returning();
  return inv;
  });
}

/** Mark an invoice paid by a transaction and credit what arrived. A transaction can pay only once. */
async function settle(db: DB, inv: Invoice, p: { txHash: string; from: string; amountMicro: number }, appUrl?: string) {
  if (!Number.isSafeInteger(p.amountMicro) || p.amountMicro <= 0) throw new Error("Payment amount is outside supported micro-USDC precision");
  const hash = p.txHash.toLowerCase();
  const result = await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-payment:${hash}`}))`);
  const db = tx as unknown as DB;
  const [dupe] = await db.select({ id: s.billingInvoices.id }).from(s.billingInvoices).where(eq(s.billingInvoices.txHash, hash));
  if (dupe && dupe.id !== inv.id) throw new Error("That transaction has already paid another invoice.");
  const claimed = await db
    .update(s.billingInvoices)
    .set({ status: "paid", txHash: hash, payer: p.from, paidMicro: p.amountMicro, paidAt: new Date() })
    .where(and(eq(s.billingInvoices.id, inv.id), inArray(s.billingInvoices.status, ["pending", "expired"])))
    .returning({ id: s.billingInvoices.id });
  if (!claimed.length) return { creditedMicro: 0 };
  await addCredit(db, { userId: inv.userId, amountMicro: p.amountMicro, ref: inv.id, note: `Arc ${hash}` });
  await resolveByRef(db, "unmatched_payment", hash, `Applied to invoice ${inv.id}`);
  return { creditedMicro: p.amountMicro };
  });
  if (result.creditedMicro) await receiptEmail(db, inv.userId, { amountMicro: result.creditedMicro, txHash: hash, chain: inv.chain, appUrl });
  return result;
}

/** Look on Arc for a transfer of exactly the invoice amount to the billing address. */
export async function checkInvoice(db: DB, inv: Invoice, appUrl?: string): Promise<{ paid: boolean }> {
  if (inv.status === "paid") return { paid: true };
  if (inv.status !== "pending") return { paid: false };
  const transfers = await transfersTo(inv.payTo, BigInt(inv.fromBlock));
  // A transaction may emit several transfers to us. Its hash is claimed once, so use the
  // full received amount instead of crediting one log and losing the rest of that payment.
  const grouped = new Map<string, (typeof transfers)[number]>();
  for (const transfer of transfers) {
    const hash = transfer.txHash.toLowerCase();
    const prior = grouped.get(hash);
    grouped.set(hash, prior ? { ...prior, amountMicro: prior.amountMicro + transfer.amountMicro } : { ...transfer, txHash: hash });
  }
  const hits = [...grouped.values()];
  const hashes = hits.map((h) => h.txHash.toLowerCase());
  const used = new Set(hashes.length ? (await db.select({ h: s.billingInvoices.txHash }).from(s.billingInvoices).where(inArray(s.billingInvoices.txHash, hashes))).map((r) => r.h) : []);
  const match = hits.find((h) => h.amountMicro === inv.amountMicro && !used.has(h.txHash.toLowerCase()));
  if (!match) {
    if (inv.expiresAt.getTime() < Date.now()) await db.update(s.billingInvoices).set({ status: "expired" }).where(and(eq(s.billingInvoices.id, inv.id), eq(s.billingInvoices.status, "pending")));
    return { paid: false };
  }
  await settle(db, inv, match, appUrl);
  return { paid: true };
}

/**
 * Pay an invoice with a transaction hash the payer gives us. Any amount of at least the requested
 * top-up counts (the matching suffix only matters for automatic detection), as long as the
 * transaction went to the billing address after the invoice was created. Works for an expired
 * invoice too, so a slow payer isn't stranded.
 */
export async function payInvoiceWithTx(db: DB, inv: Invoice, txHash: string, appUrl?: string, expectedFrom?: string): Promise<{ paid: boolean }> {
  if (!isTxHash(txHash)) throw new Error("That doesn't look like a transaction hash (0x followed by 64 characters).");
  if (inv.status === "paid") return { paid: true };
  const p = await paymentInTx(txHash, inv.payTo);
  if (!p) throw new Error("We can't find a successful transaction with that hash on Arc yet. If you just sent it, wait a few seconds and try again.");
  if (expectedFrom && p.from.toLowerCase() !== expectedFrom.toLowerCase()) throw new Error("The Arc payment did not come from this workspace wallet.");
  const [used] = await db.select({ id: s.billingInvoices.id }).from(s.billingInvoices).where(eq(s.billingInvoices.txHash, txHash.toLowerCase()));
  if (used && used.id !== inv.id) throw new Error("That transaction has already paid another invoice.");
  if (p.blockNumber < BigInt(inv.fromBlock)) throw new Error("That transaction happened before this invoice was created, so it can't pay it.");
  if (p.amountMicro < inv.priceMicro) {
    throw new Error(p.amountMicro === 0 ? `That transaction didn't send USDC to ${inv.payTo}.` : `That transaction sent ${fmtUsdc(p.amountMicro)}; this top-up is ${fmtUsdc(inv.priceMicro)}.`);
  }
  // A payment of another person's exact invoice amount is theirs, even if it hasn't been matched yet:
  // without this, anyone who saw the hash could paste it into their own invoice and take the credit.
  if (p.amountMicro !== inv.amountMicro) {
    const [owner] = await db
      .select({ id: s.billingInvoices.id })
      .from(s.billingInvoices)
      .where(and(eq(s.billingInvoices.payTo, inv.payTo), eq(s.billingInvoices.amountMicro, p.amountMicro), inArray(s.billingInvoices.status, ["pending", "expired"]), sql`${s.billingInvoices.userId} <> ${inv.userId}`, gt(s.billingInvoices.createdAt, new Date(Date.now() - 7 * 86_400_000))))
      .limit(1);
    if (owner) throw new Error("That transaction matches another top-up request. If it's yours, open that request from Billing and check the transaction there.");
  }
  await settle(db, inv, { txHash, from: p.from, amountMicro: p.amountMicro }, appUrl);
  return { paid: true };
}

/** Background pass: check every recent open invoice against Arc. */
export async function checkOpenInvoices(db: DB, appUrl?: string) {
  const open = await db.select().from(s.billingInvoices).where(and(eq(s.billingInvoices.status, "pending"), gt(s.billingInvoices.expiresAt, new Date(Date.now() - 10 * 60_000))));
  let paid = 0;
  for (const inv of open) {
    try {
      if ((await checkInvoice(db, inv, appUrl)).paid) paid++;
    } catch (e) {
      console.warn(`[billing] check ${inv.id}: ${(e as Error).message}`);
    }
  }
  return { checked: open.length, paid };
}
