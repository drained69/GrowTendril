import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { sendEmail } from "@/server/integrations/email";

/**
 * Ledger exceptions: every place the books and the chain disagree, opened once (per kind and
 * ref), announced by email, and kept open until a person resolves it with a note. Nothing is
 * rounded away or corrected silently.
 */

export type ExceptionKind = "unmatched_payment" | "payout_mismatch" | "payout_unverified" | "unrecorded_outflow";
export type LedgerException = typeof s.ledgerExceptions.$inferSelect;

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  unmatched_payment: "Payment that matched no invoice",
  payout_mismatch: "Payout differs from what was approved",
  payout_unverified: "Payout couldn't be checked on Arc",
  unrecorded_outflow: "USDC left the wallet without a record",
};

export interface NewException {
  scope: "billing" | "wallet";
  projectId?: string | null;
  kind: ExceptionKind;
  ref: string;
  txHash?: string | null;
  transactionId?: string | null;
  amountMicro?: number | null;
  counterparty?: string | null;
  detail: string;
}

/** Open an exception. Returns false if this one (kind + ref) is already on record. */
export async function openException(db: DB, e: NewException): Promise<boolean> {
  const r = await db
    .insert(s.ledgerExceptions)
    .values({ id: newId(), scope: e.scope, projectId: e.projectId ?? null, kind: e.kind, ref: e.ref, txHash: e.txHash ?? null, transactionId: e.transactionId ?? null, amountMicro: e.amountMicro ?? null, counterparty: e.counterparty ?? null, detail: e.detail })
    .onConflictDoNothing()
    .returning({ id: s.ledgerExceptions.id });
  if (!r.length) return false;
  console.warn(`[ledger] ${e.kind} ${e.ref}: ${e.detail}`);
  await alert(db, e).catch((err) => console.warn(`[ledger] alert email failed: ${(err as Error).message}`));
  return true;
}

/** Billing exceptions go to the operator (OPERATOR_EMAIL); wallet exceptions to the workspace owner. */
async function alert(db: DB, e: NewException) {
  const app = process.env.APP_URL?.trim().replace(/\/$/, "") ?? "";
  if (e.scope === "billing") {
    const to = process.env.OPERATOR_EMAIL?.trim();
    if (!to) return;
    await sendEmail(db, { to, kind: "ledger_alert", subject: `Billing needs a look: ${EXCEPTION_LABEL[e.kind].toLowerCase()}`, text: `${e.detail}\n\nIt stays open until someone resolves it. List open items with: npm run ledger:exceptions` });
    return;
  }
  if (!e.projectId) return;
  const [o] = await db
    .select({ email: s.users.email, name: s.users.name, id: s.users.id, project: s.projects.name })
    .from(s.projects)
    .innerJoin(s.users, eq(s.projects.ownerId, s.users.id))
    .where(eq(s.projects.id, e.projectId));
  if (!o) return;
  await sendEmail(db, {
    to: o.email,
    userId: o.id,
    kind: "ledger_alert",
    subject: `${o.project}: ${EXCEPTION_LABEL[e.kind].toLowerCase()}`,
    text: `Hi ${o.name.split(" ")[0] || "there"},\n\nGrowTendril compared ${o.project}'s payment records with Arc and found something that doesn't match:\n\n${e.detail}\n\nNothing has been corrected automatically. Review it in the wallet and mark it resolved with a note once you know what happened.`,
    action: app ? { label: "Review in Wallet", url: `${app}/app/wallet` } : undefined,
  });
}

/** A person closes an exception with a note. Scoped to the workspace when one is given. */
export async function resolveException(db: DB, v: { id: string; userId: string; resolution: string; projectId?: string }): Promise<boolean> {
  const note = v.resolution.trim();
  if (note.length < 3) throw new Error("Say what you found, so the next person reading this knows why it was closed.");
  const where = v.projectId ? and(eq(s.ledgerExceptions.id, v.id), eq(s.ledgerExceptions.projectId, v.projectId), eq(s.ledgerExceptions.status, "open")) : and(eq(s.ledgerExceptions.id, v.id), eq(s.ledgerExceptions.status, "open"));
  const r = await db.update(s.ledgerExceptions).set({ status: "resolved", resolution: note.slice(0, 500), resolvedBy: v.userId, resolvedAt: new Date() }).where(where).returning({ id: s.ledgerExceptions.id });
  return r.length > 0;
}

/** Close an exception the system itself has since explained (e.g. the payer gave the hash for an invoice). */
export async function resolveByRef(db: DB, kind: ExceptionKind, ref: string, resolution: string) {
  await db
    .update(s.ledgerExceptions)
    .set({ status: "resolved", resolution, resolvedBy: "system", resolvedAt: new Date() })
    .where(and(eq(s.ledgerExceptions.kind, kind), eq(s.ledgerExceptions.ref, ref), eq(s.ledgerExceptions.status, "open")));
}

export async function exceptionsFor(db: DB, v: { projectId?: string; scope?: "billing" | "wallet"; status?: "open" | "resolved"; limit?: number }) {
  const conds = [
    v.projectId ? eq(s.ledgerExceptions.projectId, v.projectId) : undefined,
    v.scope ? eq(s.ledgerExceptions.scope, v.scope) : undefined,
    v.status ? eq(s.ledgerExceptions.status, v.status) : undefined,
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(s.ledgerExceptions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(s.ledgerExceptions.createdAt))
    .limit(v.limit ?? 50);
}

/** Read and move a chain cursor (the last block a scan has fully read). */
export async function cursorGet(db: DB, key: string): Promise<bigint | null> {
  const [c] = await db.select().from(s.chainCursors).where(eq(s.chainCursors.key, key));
  return c ? BigInt(c.block) : null;
}

export async function cursorSet(db: DB, key: string, block: bigint) {
  await db
    .insert(s.chainCursors)
    .values({ key, block: block.toString() })
    .onConflictDoUpdate({ target: s.chainCursors.key, set: { block: block.toString(), updatedAt: new Date() } });
}
