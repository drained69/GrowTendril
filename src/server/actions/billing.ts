"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { currentUser } from "@/server/auth/current";
import { addCredit, billingMode, checkInvoice, createInvoice, parseTopUp, payInvoiceWithTx, payToAddress } from "@/server/domain/billing";
import { newId } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal } from "@/lib/money";
import { appOrigin } from "@/server/lib/origin";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";
import { checkWithdrawal, withdraw, withdrawalScope } from "@/server/domain/agent/withdraw";
import { issueCode, consumeCode } from "@/server/domain/auth/codes";

async function verifiedUser() {
  const user = await currentUser();
  if (!user) throw new Error("You are signed out — sign in again.");
  if (!user.emailVerified) throw new Error("Confirm your email first — enter the code we sent you.");
  return user;
}

async function ownInvoice(invoiceId: string, userId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(s.billingInvoices).where(and(eq(s.billingInvoices.id, invoiceId), eq(s.billingInvoices.userId, userId)));
  if (!inv) throw new Error("Invoice not found");
  return { db, inv };
}

/** Only the owner of the selected workspace may move its USDC into their billing credit. */
async function walletInvoice(invoiceId: string) {
  const { user, project, db } = await guard("manage_workspace");
  if (project.ownerId !== user.id) throw new Error("Only the workspace owner can pay from its wallet.");
  if (billingMode() !== "arc") throw new Error("Arc billing is unavailable.");
  const [inv] = await db.select().from(s.billingInvoices).where(and(eq(s.billingInvoices.id, invoiceId), eq(s.billingInvoices.userId, user.id)));
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status !== "pending" || inv.expiresAt.getTime() <= Date.now()) throw new Error("This invoice is no longer open. Create a new top-up.");
  if (inv.payTo.toLowerCase() !== payToAddress()?.toLowerCase()) throw new Error("The billing address has changed. Create a new top-up.");
  return { user, project, db, inv };
}

const invoiceTransferPrefix = (projectId: string, invoiceId: string) => `withdraw:${projectId}:billing-invoice:${invoiceId}:`;

async function assertNoWalletPaymentInFlight(db: Awaited<ReturnType<typeof getDb>>, projectId: string, invoiceId: string) {
  const [existing] = await db.select({ state: s.transactions.state }).from(s.transactions).where(and(
    eq(s.transactions.projectId, projectId),
    like(s.transactions.idempotencyKey, `${invoiceTransferPrefix(projectId, invoiceId)}%`),
  )).limit(1);
  // Even FAILED may mean Circle accepted a send before the SDK timed out. Never auto-send twice.
  if (existing) throw new Error("A wallet payment was already attempted for this invoice. Check its Arc receipt before trying another payment; contact support if its status is unclear.");
}

/** Email confirmation for the exact invoice amount and billing destination. */
export async function requestWalletInvoiceCodeAction(invoiceId: string): Promise<ActionResult<{ summary: string }>> {
  try {
    const { user, project, db, inv } = await walletInvoice(invoiceId);
    await limited(`wallet-invoice-code:${user.id}`, 5, 0.02);
    await assertNoWalletPaymentInFlight(db, project.id, inv.id);
    const checked = await checkWithdrawal(db, project.id, { amount: microToDecimal(inv.amountMicro), to: inv.payTo });
    const summary = `${fmtUsdc(inv.amountMicro)} from ${checked.walletAddress} to GrowTendril billing (${inv.payTo}) for invoice ${inv.id}`;
    await issueCode(db, user, "withdraw", Date.now(), { scope: `${withdrawalScope(project.id, inv.amountMicro, inv.payTo)}:invoice:${inv.id}`, summary });
    return { ok: true, data: { summary }, message: `We emailed a code to ${user.email}. It authorizes only this invoice payment.` };
  } catch (e) { return fail(e); }
}

/** Explicitly approved wallet payment. Billing credit is added only when Arc confirms the transfer. */
export async function payWalletInvoiceAction(invoiceId: string, code: string): Promise<ActionResult<{ state: string; txHash: string | null }>> {
  try {
    const { user, project, db, inv } = await walletInvoice(invoiceId);
    await limited(`wallet-invoice-pay:${user.id}`, 5, 0.02);
    await assertNoWalletPaymentInFlight(db, project.id, inv.id);
    const checked = await checkWithdrawal(db, project.id, { amount: microToDecimal(inv.amountMicro), to: inv.payTo });
    const codeId = await consumeCode(db, user.id, "withdraw", code, Date.now(), `${withdrawalScope(project.id, inv.amountMicro, inv.payTo)}:invoice:${inv.id}`);
    const sent = await withdraw(db, { projectId: project.id, userId: user.id, amount: microToDecimal(inv.amountMicro), to: inv.payTo, requestKey: `billing-invoice:${inv.id}:${codeId}` });
    if (sent.state === "FAILED") return { ok: false, error: "The wallet payment did not confirm. No scan credit was added. Check its Arc receipt before trying another payment." };
    if (sent.state === "EXCEPTION") return { ok: false, error: "The Arc transfer did not match the approved payment. Scan credit was not added; contact support." };
    let credited = false;
    if (sent.state === "SETTLED" && sent.txHash) {
      try {
        await payInvoiceWithTx(db, inv, sent.txHash, await appOrigin(), checked.walletAddress);
        credited = true;
        revalidatePath("/", "layout");
      } catch (e) {
        // The receipt can precede RPC transaction indexing. Keep watching the exact invoice;
        // no second transfer is allowed, and the background matcher will add credit on arrival.
        if (!(e instanceof Error) || !e.message.includes("can't find a successful transaction")) throw e;
      }
    }
    await audit(db, { actorType: "user", actorId: user.id, action: "billing.wallet_payment", target: inv.id, data: { projectId: project.id, txHash: sent.txHash, state: sent.state } });
    return { ok: true, data: { state: credited ? "SETTLED" : "SUBMITTED", txHash: sent.txHash }, message: credited ? "Wallet payment verified on Arc. Scan credit is ready." : "Wallet payment sent. Arc confirmation is in progress; this page will add credit when it arrives." };
  } catch (e) { return fail(e); }
}

/** Top up: an invoice for an exact USDC amount on Arc, then its payment page. */
export async function createTopUpAction(usdc: number | string): Promise<ActionResult> {
  let id = "";
  try {
    await limited("invoice", 10, 0.05);
    const user = await verifiedUser();
    const amount = parseTopUp(usdc);
    if (billingMode() !== "arc") return { ok: false, error: "USDC payments aren't set up on this deployment yet." };
    const db = await getDb();
    const inv = await createInvoice(db, user.id, amount);
    await audit(db, { actorType: "user", actorId: user.id, action: "billing.invoice_created", target: inv.id, data: { amountMicro: inv.amountMicro } });
    id = inv.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/billing/pay/${id}`);
}

/** Has the payment for this invoice arrived on Arc yet? Polled by the payment page. */
export async function checkInvoiceAction(invoiceId: string): Promise<ActionResult<{ paid: boolean; status: string }>> {
  try {
    await limited("invoice-check", 30, 0.5);
    const user = await verifiedUser();
    const { db, inv } = await ownInvoice(invoiceId, user.id);
    const r = await checkInvoice(db, inv, await appOrigin());
    const [now] = await db.select({ status: s.billingInvoices.status }).from(s.billingInvoices).where(eq(s.billingInvoices.id, inv.id));
    if (r.paid) revalidatePath("/", "layout");
    return { ok: true, data: { paid: r.paid, status: now?.status ?? inv.status } };
  } catch (e) {
    return fail(e);
  }
}

const TxForm = z.object({ txHash: z.string().trim().min(10, "Paste the transaction hash").max(80) });

/** "I've paid": verify a transaction hash the payer gives. */
export async function payWithTxAction(invoiceId: string, _: unknown, form: FormData): Promise<ActionResult> {
  try {
    await limited("invoice-tx", 10, 0.1);
    const user = await verifiedUser();
    const { txHash } = TxForm.parse({ txHash: form.get("txHash") });
    const { db, inv } = await ownInvoice(invoiceId, user.id);
    await payInvoiceWithTx(db, inv, txHash, await appOrigin());
    await audit(db, { actorType: "user", actorId: user.id, action: "billing.paid", target: inv.id, data: { txHash } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Payment confirmed on Arc" };
  } catch (e) {
    return fail(e);
  }
}

/** Development only: stand in for a USDC top-up so the paid flow can be exercised end to end. */
export async function devTopUpAction(usdc: number | string): Promise<ActionResult> {
  try {
    if (billingMode() !== "dev") return { ok: false, error: "Not available" };
    const user = await verifiedUser();
    const amount = parseTopUp(usdc);
    const db = await getDb();
    await addCredit(db, { userId: user.id, amountMicro: amount, ref: `dev:${newId()}`, note: "Development stand-in for a USDC payment" });
    await audit(db, { actorType: "user", actorId: user.id, action: "billing.dev_topup", data: { amountMicro: amount } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${fmtUsdc(amount)} added (development stand-in for a USDC payment)` };
  } catch (e) {
    return fail(e);
  }
}
