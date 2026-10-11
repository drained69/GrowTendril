"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { currentUser } from "@/server/auth/current";
import { addCredit, billingMode, checkInvoice, createInvoice, parseTopUp, payInvoiceWithTx } from "@/server/domain/billing";
import { newId } from "@/server/lib/ids";
import { fmtUsdc } from "@/lib/money";
import { appOrigin } from "@/server/lib/origin";
import { fail, limited, type ActionResult } from "@/server/actions/_common";

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
