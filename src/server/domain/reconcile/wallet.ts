import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { fmtUsdc } from "@/lib/money";
import { ARC, txExplorerUrl } from "@/server/integrations/circle/config";
import { getWallet } from "@/server/integrations/circle/wallets";
import { currentBlock, payoutInTx, transfersFrom } from "@/server/domain/billing/arc";
import { transition } from "@/server/domain/agent/ledger";
import { cursorGet, cursorSet, openException } from "@/server/domain/reconcile/exceptions";
import { verifyTransfers } from "@arc-growth/evidence";

/**
 * Arc as the independent witness for an agent wallet. Circle saying "sent" is not proof; the
 * chain is. Two checks:
 *   confirmSend — a payout counts as settled only once Arc shows the approved amount reaching
 *                 the approved address, and nothing else leaving the wallet in that transaction.
 *   reconcileWalletOutflows — every USDC transfer out of the wallet must match a recorded
 *                 payment; anything else is opened as an exception.
 * Arc logs every USDC movement (gas deductions excepted), so both checks see native sends too.
 */

/** How far back the first outflow scan of a wallet reads. */
export const FIRST_SCAN_BLOCKS = 200_000n;
/** Most blocks one run reads; a longer backlog continues on the next run. */
export const MAX_SCAN_BLOCKS = 500_000n;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Move a SUBMITTED App Kit send to SETTLED or FAILED from what Arc shows, recording the check.
 * Leaves it SUBMITTED while the transaction isn't mined yet. Returns the resulting state.
 */
export async function confirmSend(db: DB, txId: string): Promise<string> {
  const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
  if (!tx) throw new Error(`transaction ${txId} not found`);
  if (tx.state !== "SUBMITTED") return tx.state;
  const wallet = await getWallet(db, tx.projectId);
  const now = new Date();
  if (!tx.txHash || !wallet?.address || !tx.recipient) {
    const why = !tx.txHash ? "Circle reported the payout as sent but returned no transaction hash" : !wallet?.address ? "the workspace wallet has no address on record" : "the payment has no recipient on record";
    await db.update(s.transactions).set({ chainCheck: "unverified", chainCheckedAt: now }).where(and(eq(s.transactions.id, tx.id), eq(s.transactions.state, "SUBMITTED")));
    await openException(db, { scope: "wallet", projectId: tx.projectId, kind: "payout_unverified", ref: tx.id, transactionId: tx.id, txHash: tx.txHash, amountMicro: tx.amountMicro, counterparty: tx.recipient, detail: `A ${fmtUsdc(tx.amountMicro)} payout was marked sent, but it couldn't be checked on Arc: ${why}. Confirm in the Circle console that it reached the right address.` });
    return "SUBMITTED";
  }
  const r = await payoutInTx(tx.txHash, wallet.address, tx.recipient);
  if (r.status === "pending") return "SUBMITTED";
  if (r.status === "reverted") {
    await transition(db, tx.id, "FAILED", { chainCheck: "verified", chainCheckedAt: now, error: "Reverted on Arc" }, `Transaction reverted on Arc in block ${r.blockNumber}; no USDC moved`);
    return "FAILED";
  }
  const elsewhereMicro = r.elsewhere.reduce((n, e) => n + e.amountMicro, 0);
  const checked = verifyTransfers({ chainId: ARC.chainId, asset: ARC.usdc, sender: wallet.address, recipient: tx.recipient, amountMicro: tx.amountMicro }, {
    status: "confirmed", chainId: ARC.chainId, txHash: tx.txHash, blockNumber: r.blockNumber?.toString(),
    transfers: [{ chainId: ARC.chainId, asset: ARC.usdc, sender: wallet.address, recipient: tx.recipient, amountMicro: r.toRecipientMicro }, ...r.elsewhere.map(e => ({ chainId: ARC.chainId, asset: ARC.usdc, sender: wallet.address!, recipient: e.to, amountMicro: e.amountMicro }))],
  });
  const ok = checked.status === "verified";
  const seen = `${fmtUsdc(r.toRecipientMicro)} to ${short(tx.recipient)}${r.elsewhere.length ? ` and ${r.elsewhere.map((e) => `${fmtUsdc(e.amountMicro)} to ${short(e.to)}`).join(", ")}` : ""}`;
  await transition(db, tx.id, ok ? "SETTLED" : "EXCEPTION", { chainCheck: ok ? "verified" : "mismatch", chainCheckedAt: now }, ok ? `Checked on Arc (block ${r.blockNumber}): ${fmtUsdc(tx.amountMicro)} reached ${short(tx.recipient)}` : `Arc shows ${seen}; approved was ${fmtUsdc(tx.amountMicro)} to ${short(tx.recipient)}`);
  if (!ok) {
    await openException(db, {
      scope: "wallet",
      projectId: tx.projectId,
      kind: "payout_mismatch",
      ref: tx.id,
      transactionId: tx.id,
      txHash: tx.txHash,
      amountMicro: r.toRecipientMicro + elsewhereMicro,
      counterparty: tx.recipient,
      detail: `Approved: ${fmtUsdc(tx.amountMicro)} to ${tx.recipient}. Arc shows this transaction moved ${seen} from the agent wallet. ${txExplorerUrl(tx.chain, tx.txHash)}`,
    });
  }
  return ok ? "SETTLED" : "EXCEPTION";
}

/**
 * Every USDC transfer out of a workspace's agent wallet since the last run must belong to a
 * recorded payment (same transaction hash). Unrecorded outflows become exceptions. Recorded
 * payments that were never checked (e.g. Gateway deposits) get their on-chain total checked too.
 */
export async function reconcileWalletOutflows(db: DB, projectId: string, opts: { maxBlocks?: bigint } = {}) {
  const wallet = await getWallet(db, projectId);
  if (!wallet?.address || wallet.blockchain !== ARC.circleBlockchain || wallet.dataMode !== "LIVE") return { skipped: "no Arc mainnet wallet" };
  const key = `wallet-out:${wallet.address.toLowerCase()}`;
  const latest = await currentBlock();
  const last = await cursorGet(db, key);
  const from = last != null ? last + 1n : latest > FIRST_SCAN_BLOCKS ? latest - FIRST_SCAN_BLOCKS : 0n;
  const max = opts.maxBlocks ?? MAX_SCAN_BLOCKS;
  const to = latest < from + max - 1n ? latest : from + max - 1n;
  if (to < from) return { scanned: 0, opened: 0 };

  const outs = await transfersFrom(wallet.address, from, to);
  const byHash = new Map<string, { total: number; to: Set<string> }>();
  for (const o of outs) {
    const h = o.txHash.toLowerCase();
    const e = byHash.get(h) ?? { total: 0, to: new Set<string>() };
    e.total += o.amountMicro;
    e.to.add(o.to.toLowerCase());
    byHash.set(h, e);
  }
  const hashes = [...byHash.keys()];
  const recorded = hashes.length
    ? await db
        .select()
        .from(s.transactions)
        .where(and(eq(s.transactions.projectId, projectId), or(inArray(sql`lower(${s.transactions.txHash})`, hashes), inArray(sql`lower(${s.transactions.batchTxHash})`, hashes))))
    : [];
  const known = new Map<string, (typeof recorded)[number]>();
  for (const t of recorded) for (const h of [t.txHash, t.batchTxHash]) if (h) known.set(h.toLowerCase(), t);

  let opened = 0;
  for (const [hash, out] of byHash) {
    const t = known.get(hash);
    if (!t) {
      const recipients = [...out.to];
      const made = await openException(db, {
        scope: "wallet",
        projectId,
        kind: "unrecorded_outflow",
        ref: hash,
        txHash: hash,
        amountMicro: out.total,
        counterparty: recipients[0] ?? null,
        detail: `${fmtUsdc(out.total)} left the agent wallet to ${recipients.map(short).join(", ")} with no matching payment in GrowTendril. ${txExplorerUrl(ARC.appKitChain, hash)}`,
      });
      if (made) opened++;
      continue;
    }
    // Recorded but never read back (Gateway deposits, payouts from before this check existed).
    if (!t.chainCheck && t.state === "SETTLED") {
      const ok = out.total === t.amountMicro;
      await db.update(s.transactions).set({ chainCheck: ok ? "verified" : "mismatch", chainCheckedAt: new Date() }).where(and(eq(s.transactions.id, t.id), isNull(s.transactions.chainCheck)));
      if (!ok) {
        const made = await openException(db, { scope: "wallet", projectId, kind: "payout_mismatch", ref: t.id, transactionId: t.id, txHash: hash, amountMicro: out.total, counterparty: t.recipient, detail: `Recorded: ${fmtUsdc(t.amountMicro)} (${t.kind}). Arc shows ${fmtUsdc(out.total)} leaving the agent wallet in that transaction. ${txExplorerUrl(t.chain, hash)}` });
        if (made) opened++;
      }
    }
  }
  await cursorSet(db, key, to);
  return { scanned: Number(to - from + 1n), transfers: outs.length, opened };
}

/** Workspaces with an Arc mainnet agent wallet, for the scheduler. */
export async function walletsToReconcile(db: DB): Promise<string[]> {
  const rows = await db.select({ pid: s.wallets.projectId }).from(s.wallets).where(and(eq(s.wallets.blockchain, ARC.circleBlockchain), eq(s.wallets.dataMode, "LIVE"), inArray(s.wallets.status, ["ACTIVE", "PAUSED"])));
  return rows.map((r) => r.pid);
}
