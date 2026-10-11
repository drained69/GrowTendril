import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { fmtUsdc } from "@/lib/money";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { checkOpenInvoices, payToAddress } from "@/server/domain/billing";
import { currentBlock, transfersTo } from "@/server/domain/billing/arc";
import { cursorGet, cursorSet, openException } from "@/server/domain/reconcile/exceptions";

/**
 * Every USDC transfer into the billing address must belong to an invoice. Automatic matching
 * only recognises the exact invoice amount, so a payer who rounds (20 instead of 20.004213) or
 * pays after the invoice expired leaves money that nothing credits. This scan finds those and
 * opens an exception, so they're credited or refunded on purpose instead of sitting unseen.
 */

export const MAX_SCAN_BLOCKS = 500_000n;

export async function reconcileBillingPayments(db: DB, opts: { maxBlocks?: bigint; appUrl?: string } = {}) {
  const payTo = payToAddress();
  if (!payTo) return { skipped: "billing on Arc is off" };
  // Open invoices claim their payments first, so whatever is left really matched nothing.
  await checkOpenInvoices(db, opts.appUrl);

  const key = `billing-in:${payTo.toLowerCase()}`;
  const latest = await currentBlock();
  const last = await cursorGet(db, key);
  let from: bigint;
  if (last != null) from = last + 1n;
  else {
    // First run: start at the oldest invoice to this address, so earlier stray payments surface too.
    const [r] = await db.select({ b: sql<string | null>`min((${s.billingInvoices.fromBlock})::numeric)::text` }).from(s.billingInvoices).where(eq(s.billingInvoices.payTo, payTo));
    from = r?.b ? BigInt(r.b) : latest;
  }
  const max = opts.maxBlocks ?? MAX_SCAN_BLOCKS;
  const to = latest < from + max - 1n ? latest : from + max - 1n;
  if (to < from) return { scanned: 0, opened: 0 };

  const hits = await transfersTo(payTo, from, to);
  const byHash = new Map<string, { from: string; amountMicro: number; block: bigint }>();
  for (const h of hits) {
    const k = h.txHash.toLowerCase();
    const e = byHash.get(k);
    byHash.set(k, e ? { ...e, amountMicro: e.amountMicro + h.amountMicro } : { from: h.from, amountMicro: h.amountMicro, block: h.blockNumber });
  }
  const hashes = [...byHash.keys()];
  const claimed = new Set(hashes.length ? (await db.select({ h: s.billingInvoices.txHash }).from(s.billingInvoices).where(inArray(s.billingInvoices.txHash, hashes))).map((r) => r.h!.toLowerCase()) : []);
  const pending = await db.select({ amount: s.billingInvoices.amountMicro, fromBlock: s.billingInvoices.fromBlock }).from(s.billingInvoices).where(and(eq(s.billingInvoices.payTo, payTo), eq(s.billingInvoices.status, "pending")));

  let opened = 0;
  for (const [hash, p] of byHash) {
    if (claimed.has(hash)) continue;
    // Exactly what an open invoice asks for: the invoice check will claim it.
    if (pending.some((i) => i.amount === p.amountMicro && BigInt(i.fromBlock) <= p.block)) continue;
    const made = await openException(db, {
      scope: "billing",
      kind: "unmatched_payment",
      ref: hash,
      txHash: hash,
      amountMicro: p.amountMicro,
      counterparty: p.from,
      detail: `${fmtUsdc(p.amountMicro)} arrived at the billing address from ${p.from} and matched no invoice.${await hint(db, payTo, p)} Credit it (the payer can paste this transaction hash on their invoice), refund it, or note why it's fine. ${txExplorerUrl("Arc", hash)}`,
    });
    if (made) opened++;
  }
  await cursorSet(db, key, to);
  return { scanned: Number(to - from + 1n), transfers: hits.length, opened };
}

/** Who this money probably belongs to: an invoice it nearly matches, or an account this address paid for before. */
async function hint(db: DB, payTo: string, p: { from: string; amountMicro: number }): Promise<string> {
  const [close] = await db
    .select({ email: s.users.email, amount: s.billingInvoices.amountMicro, price: s.billingInvoices.priceMicro, status: s.billingInvoices.status })
    .from(s.billingInvoices)
    .innerJoin(s.users, eq(s.billingInvoices.userId, s.users.id))
    .where(and(eq(s.billingInvoices.payTo, payTo), inArray(s.billingInvoices.status, ["pending", "expired"]), sql`abs(${s.billingInvoices.priceMicro} - ${p.amountMicro}) < 10000`))
    .orderBy(sql`${s.billingInvoices.createdAt} desc`)
    .limit(1);
  if (close) return ` It's close to a ${close.status} ${fmtUsdc(close.price)} top-up for ${close.email} (exact amount ${fmtUsdc(close.amount)}).`;
  const [prior] = await db
    .select({ email: s.users.email })
    .from(s.billingInvoices)
    .innerJoin(s.users, eq(s.billingInvoices.userId, s.users.id))
    .where(and(eq(s.billingInvoices.status, "paid"), sql`lower(${s.billingInvoices.payer}) = ${p.from.toLowerCase()}`))
    .limit(1);
  return prior ? ` This address has paid for ${prior.email} before.` : "";
}
