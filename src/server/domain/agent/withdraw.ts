import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { ARC, txExplorerUrl } from "@/server/integrations/circle/config";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { arcUsdcBalanceMicro } from "@/server/integrations/circle/wallet-balance";
import { appKitSend } from "@/server/integrations/circle/appkit";
import { createTransaction, transition } from "@/server/domain/agent/ledger";
import { recordDecision, updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { confirmSend } from "@/server/domain/reconcile/wallet";
import { sendEmail } from "@/server/integrations/email";

/**
 * OWNER WITHDRAWAL — the way USDC leaves a workspace wallet other than an approved payment.
 *
 * Funds a customer puts in their workspace wallet are theirs. The wallet is a Circle
 * developer-controlled EOA under the platform's Circle entity, so without this the only exit
 * would be agent payments. A withdrawal:
 *   - is owner-only and confirmed by an emailed code bound to this exact amount and address;
 *   - is serialized with agent payments (same advisory lock), and never takes funds already
 *     committed to an in-flight payment, nor the few cents Arc needs for its USDC network fee;
 *   - is a treasury movement, so it never counts against mission budgets or daily caps;
 *   - is recorded like any payment (decision, receipt, ledger row), and only marked SETTLED
 *     once Arc shows the amount reaching the address — the same chain check as payouts.
 */

/** Left in the wallet for Arc's network fee, which is paid in USDC from the same balance. */
export const GAS_RESERVE_MICRO = 50_000; // 0.05 USDC
export const MIN_WITHDRAW_MICRO = 10_000; // 0.01 USDC
const IN_FLIGHT = ["AUTHORIZED", "EXECUTING", "SUBMITTED"] as const;

const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0{40}$/i.test(a);

export class WithdrawError extends Error {}

export interface WithdrawableBalance {
  balanceMicro: number;
  inFlightMicro: number;
  availableMicro: number;
}

/** What the owner can take out now: on-chain balance minus in-flight payments and the fee reserve. */
export async function withdrawable(db: DB, projectId: string, readBalance = arcUsdcBalanceMicro): Promise<WithdrawableBalance> {
  const wallet = await getWallet(db, projectId);
  if (!wallet?.address || !walletIsLive(wallet)) throw new WithdrawError("This workspace has no Arc mainnet wallet that can sign.");
  const balanceMicro = await readBalance(wallet.address);
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}), 0)` })
    .from(s.transactions)
    .where(and(eq(s.transactions.projectId, projectId), inArray(s.transactions.state, [...IN_FLIGHT])));
  const inFlightMicro = Number(r?.n ?? 0);
  return { balanceMicro, inFlightMicro, availableMicro: Math.max(0, balanceMicro - inFlightMicro - GAS_RESERVE_MICRO) };
}

/** Validates a request and returns the amount in micro-USDC. Shared by "email me a code" and "withdraw". */
export async function checkWithdrawal(db: DB, projectId: string, input: { amount: string; to: string }, readBalance = arcUsdcBalanceMicro): Promise<{ amountMicro: number; to: string; walletAddress: string }> {
  const wallet = await getWallet(db, projectId);
  if (!wallet?.address || !walletIsLive(wallet)) throw new WithdrawError("This workspace has no Arc mainnet wallet that can sign.");
  if (wallet.frozen) throw new WithdrawError("The wallet is frozen. Resume spending on this page before withdrawing.");
  const to = input.to.trim();
  if (!isAddress(to)) throw new WithdrawError("Enter an Arc (EVM) address: 0x followed by 40 hex characters.");
  if (to.toLowerCase() === wallet.address.toLowerCase()) throw new WithdrawError("That is this workspace wallet's own address.");
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(input.amount.trim())) throw new WithdrawError("Enter an amount in USDC, e.g. 12.50.");
  const amountMicro = toMicro(input.amount.trim());
  if (amountMicro < MIN_WITHDRAW_MICRO) throw new WithdrawError(`Withdraw at least ${fmtUsdc(MIN_WITHDRAW_MICRO)}.`);
  const w = await withdrawable(db, projectId, readBalance);
  if (amountMicro > w.availableMicro) {
    throw new WithdrawError(
      `You can withdraw up to ${fmtUsdc(w.availableMicro)}: the wallet holds ${fmtUsdc(w.balanceMicro)}${w.inFlightMicro ? `, ${fmtUsdc(w.inFlightMicro)} is committed to payments in progress` : ""}, and ${fmtUsdc(GAS_RESERVE_MICRO)} stays for Arc's network fee.`,
    );
  }
  return { amountMicro, to, walletAddress: wallet.address };
}

/** The scope an emailed code is bound to: this workspace, this amount, this destination. */
export const withdrawalScope = (projectId: string, amountMicro: number, to: string) => `withdraw:${projectId}:${amountMicro}:${to.toLowerCase()}`;

/**
 * Send USDC from the workspace wallet to `to`. `requestKey` (the consumed email code's id) makes a
 * retried request the same withdrawal instead of a second one.
 */
export async function withdraw(db: DB, a: { projectId: string; userId: string; amount: string; to: string; requestKey: string }, readBalance = arcUsdcBalanceMicro) {
  // Serialize with agent payments so a payout and a withdrawal can't both spend the same USDC.
  const prepared = await db.transaction(async (trx) => {
    await trx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${a.projectId}`}))`);
    const tdb = trx as unknown as DB;
    const { amountMicro, to } = await checkWithdrawal(tdb, a.projectId, a, readBalance);
    const wallet = (await getWallet(tdb, a.projectId))!;
    const action = { action: "withdraw", amount: microToDecimal(amountMicro), currency: "USDC", recipient: to, chain: ARC.appKitChain };
    const idempotencyKey = `withdraw:${a.projectId}:${a.requestKey}`;
    const [already] = await tdb.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, idempotencyKey));
    if (already) return { tx: already, duplicate: true };
    const decision = await recordDecision(tdb, {
      projectId: a.projectId,
      agent: "owner",
      kind: "withdrawal",
      action,
      rationale: `Owner withdrawal of ${fmtUsdc(amountMicro)} to ${to}, confirmed with an emailed code.`,
      inputs: { requestedBy: a.userId },
      status: "approved",
      autonomous: false,
      dataMode: "LIVE",
    });
    const { tx } = await createTransaction(tdb, {
      projectId: a.projectId,
      walletId: wallet.id,
      decisionId: decision.id,
      kind: "send",
      rail: "app_kit_send",
      budgetCategory: "treasury",
      amountMicro,
      chain: ARC.appKitChain,
      recipient: to,
      idempotencyKey,
      dataMode: "LIVE",
    });
    await transition(tdb, tx.id, "AUTHORIZED", {}, "owner withdrawal confirmed by emailed code");
    await transition(tdb, tx.id, "EXECUTING", {}, "execution lock acquired");
    await audit(tdb, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.withdraw", target: tx.id, data: { amountMicro, to } });
    return { tx, duplicate: false };
  });
  const tx = prepared.tx;
  if (prepared.duplicate) return { state: tx.state, txHash: tx.txHash, amountMicro: tx.amountMicro, to: tx.recipient!, duplicate: true };

  const wallet = (await getWallet(db, a.projectId))!;
  let state = "FAILED";
  let txHash: string | null = null;
  try {
    const res = await appKitSend(wallet, { chain: ARC.appKitChain, to: tx.recipient!, amount: microToDecimal(tx.amountMicro) });
    txHash = res.txHash;
    const patch = { txHash: res.txHash, explorerUrl: res.explorerUrl ?? (res.txHash ? txExplorerUrl(ARC.appKitChain, res.txHash) : null), error: res.state === "error" ? "App Kit reported error" : null };
    if (res.state === "error") await transition(db, tx.id, "FAILED", patch, "App Kit reported an error");
    else {
      await transition(db, tx.id, "SUBMITTED", patch, "withdrawal submitted to Arc");
      state = res.state === "success" ? await confirmSend(db, tx.id) : "SUBMITTED";
    }
  } catch (e) {
    const [current] = await db.select().from(s.transactions).where(eq(s.transactions.id, tx.id));
    // Already handed to Circle: never mark it failed (it may still land); confirmation continues in the background.
    if (current && ["SUBMITTED", "SETTLED"].includes(current.state)) state = current.state;
    else await transition(db, tx.id, "FAILED", { error: (e as Error).message }, (e as Error).message);
    txHash = current?.txHash ?? txHash;
  }
  await updateDecision(db, tx.decisionId, { status: state === "FAILED" ? "failed" : "executed", result: { state, txHash } });
  await writeReceipt(db, tx.decisionId);
  if (state !== "FAILED") {
    const [owner] = await db.select({ email: s.users.email, name: s.users.name }).from(s.users).where(eq(s.users.id, a.userId));
    if (owner)
      await sendEmail(db, {
        to: owner.email,
        userId: a.userId,
        kind: "withdrawal",
        subject: `Withdrawal of ${fmtUsdc(tx.amountMicro)} ${state === "SETTLED" ? "settled" : "sent"} on Arc`,
        text: `Hi ${owner.name.split(" ")[0] || "there"},\n\n${fmtUsdc(tx.amountMicro)} left your GrowTendril workspace wallet for ${tx.recipient}.\n\nStatus: ${state === "SETTLED" ? "settled — Arc shows the full amount at that address" : "submitted — confirming on Arc"}${txHash ? `\nTransaction: ${txExplorerUrl(ARC.appKitChain, txHash)}` : ""}\n\nIf this wasn't you, change your password and freeze the wallet now.`,
      }).catch(() => undefined);
  }
  return { state, txHash, amountMicro: tx.amountMicro, to: tx.recipient!, duplicate: false };
}
