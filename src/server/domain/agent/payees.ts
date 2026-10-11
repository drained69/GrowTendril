import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Who a payment goes to is the one thing no bank or chain check can catch: Arc confirms you paid
 * exactly the address you named. So payee changes get their own controls, the way accounting
 * systems log changes to a vendor's bank details:
 *   - every change of a payout address is audited with the old and new address;
 *   - the approver sees whether this address was ever paid before, and when and by whom it was set;
 *   - for a day after an existing address is replaced, the person who replaced it can't also
 *     approve a payment to the new one (another approver can, or it waits);
 *   - a payment proposed before the address changed can't be approved against the new address.
 */

export const PAYEE_HOLD_MS = 24 * 3_600_000;
export const PAYEE_CHANGE_ACTIONS = ["kol.payout_address", "experiment.recipient"] as const;

export interface PayeeContext {
  address: string;
  /** Never received a settled payment from this workspace. */
  firstPayment: boolean;
  lastPaidAt: Date | null;
  /** The most recent time someone set a payout address to this one. */
  setBy: { at: Date; userId: string | null; name: string | null; replaced: string | null } | null;
}

export async function payeeContext(db: DB, projectId: string, address: string): Promise<PayeeContext> {
  const a = address.toLowerCase();
  const [paid] = await db
    .select({ at: sql<Date | null>`max(${s.transactions.createdAt})` })
    .from(s.transactions)
    .where(and(eq(s.transactions.projectId, projectId), eq(s.transactions.kind, "send"), eq(s.transactions.state, "SETTLED"), sql`lower(${s.transactions.recipient}) = ${a}`));
  const [set] = await db
    .select({ at: s.auditLogs.at, userId: s.auditLogs.actorId, name: s.users.name, data: s.auditLogs.data })
    .from(s.auditLogs)
    .leftJoin(s.users, eq(s.auditLogs.actorId, s.users.id))
    .where(and(eq(s.auditLogs.projectId, projectId), inArray(s.auditLogs.action, [...PAYEE_CHANGE_ACTIONS]), sql`lower(${s.auditLogs.data}->>'to') = ${a}`))
    .orderBy(desc(s.auditLogs.at))
    .limit(1);
  const lastPaidAt = paid?.at ? new Date(paid.at) : null;
  const replaced = typeof set?.data?.from === "string" ? set.data.from : null;
  return { address, firstPayment: !lastPaidAt, lastPaidAt, setBy: set ? { at: set.at, userId: set.userId, name: set.name, replaced } : null };
}

/** Why `approverId` may not approve a payment to this address right now, or null if they may. */
export function payeeHold(ctx: PayeeContext, approverId: string, now = Date.now()): string | null {
  const c = ctx.setBy;
  if (!c?.replaced || c.userId !== approverId) return null;
  const left = PAYEE_HOLD_MS - (now - c.at.getTime());
  if (left <= 0) return null;
  const hours = Math.ceil(left / 3_600_000);
  return `You replaced this payout address ${Math.max(1, Math.round((now - c.at.getTime()) / 60_000))} min ago, so someone else with approval rights needs to approve payments to it — or wait ${hours} hour${hours === 1 ? "" : "s"}. A changed payout address is the most common way payments go to the wrong person.`;
}

/** The address an experiment pays today (creator's payout address, or the recipient set on it). */
export async function currentPayee(db: DB, experimentId: string): Promise<string | null> {
  const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, experimentId));
  if (!exp) return null;
  const [camp] = await db.select({ kolId: s.campaigns.kolId }).from(s.campaigns).where(eq(s.campaigns.experimentId, experimentId));
  // Same rule as experimentRecipient(): a creator campaign pays the creator, anything else the recipient set on it.
  if (camp?.kolId) {
    const [kol] = await db.select({ payoutAddress: s.kols.payoutAddress }).from(s.kols).where(eq(s.kols.id, camp.kolId));
    return kol?.payoutAddress ?? null;
  }
  return exp.recipientAddress;
}

/**
 * Checks before a person approves a payment to someone. Throws with the reason when the
 * payment can't be approved by this person right now.
 */
export async function assertPayeeApprovable(db: DB, tx: { projectId: string; experimentId: string | null; recipient: string | null }, approverId: string) {
  if (!tx.recipient) return;
  if (tx.experimentId) {
    const [program] = await db.select().from(s.creatorPrograms).where(and(eq(s.creatorPrograms.experimentId, tx.experimentId), eq(s.creatorPrograms.projectId, tx.projectId)));
    const now = program ? tx.recipient : await currentPayee(db, tx.experimentId);
    if (!now || now.toLowerCase() !== tx.recipient.toLowerCase()) {
      throw new Error(
        `This experiment's payout address changed after the payment was proposed (${tx.recipient} → ${now ?? "none"}). Reject this request and propose the payment again, so the new address gets its own review.`,
      );
    }
  }
  const hold = payeeHold(await payeeContext(db, tx.projectId, tx.recipient), approverId);
  if (hold) throw new Error(hold);
}
