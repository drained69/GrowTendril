import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { sendEmail } from "@/server/integrations/email";

/**
 * Emailed one-time codes. Six digits, valid for 10 minutes, five attempts, single use.
 * Only a salted hash is stored. A new code can be requested once a minute, ten a day.
 */

export type CodePurpose = "verify" | "reset" | "withdraw";
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const DAILY_CODE_CAP = 10;

// `scope` binds a code to what it authorizes (a withdrawal's amount and destination), so a code
// emailed for one transfer can't confirm a different one. Empty for verify/reset codes.
const hash = (id: string, code: string, scope = "") => createHash("sha256").update(scope ? `${id}:${code}:${scope}` : `${id}:${code}`).digest("hex");

export class CodeError extends Error {}

export async function issueCode(db: DB, user: { id: string; email: string; name: string }, purpose: CodePurpose, now = Date.now(), opts: { scope?: string; summary?: string } = {}): Promise<{ id: string }> {
  const { id, code } = await db.transaction(async (tx) => {
    // Serialize issuance and attempts for an account across all app instances.
    const [account] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, user.id)).for("update");
    if (!account) throw new CodeError("This account no longer exists.");
    const recent = await tx
      .select({ createdAt: s.emailCodes.createdAt })
      .from(s.emailCodes)
      .where(and(eq(s.emailCodes.userId, user.id), eq(s.emailCodes.purpose, purpose), gte(s.emailCodes.createdAt, new Date(now - 86_400_000))))
      .orderBy(desc(s.emailCodes.createdAt));
    if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new CodeError(`A code was just sent. You can ask for a new one in ${Math.ceil((RESEND_COOLDOWN_MS - (now - recent[0].createdAt.getTime())) / 1000)}s.`);
    }
    if (recent.length >= DAILY_CODE_CAP) throw new CodeError("Too many codes today. Try again tomorrow or contact support.");

    // Only the newest code works: older unused ones are retired.
    await tx
      .update(s.emailCodes)
      .set({ consumedAt: new Date(now) })
      .where(and(eq(s.emailCodes.userId, user.id), eq(s.emailCodes.purpose, purpose), isNull(s.emailCodes.consumedAt)));
    const id = newId();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(s.emailCodes).values({ id, userId: user.id, email: user.email, purpose, codeHash: hash(id, code, opts.scope), createdAt: new Date(now), expiresAt: new Date(now + CODE_TTL_MS) });
    return { id, code };
  });
  const first = user.name.split(" ")[0] || "there";
  await sendEmail(db, {
    to: user.email,
    userId: user.id,
    kind: purpose === "verify" ? "verify_code" : purpose === "reset" ? "reset_code" : "withdraw_code",
    subject: purpose === "verify" ? `${code} is your GrowTendril verification code` : purpose === "reset" ? `${code} is your GrowTendril password reset code` : `${code} confirms your GrowTendril withdrawal`,
    text:
      purpose === "verify"
        ? `Hi ${first},\n\nEnter this code to confirm your email and finish creating your GrowTendril account:\n\n${code}\n\nIt expires in 10 minutes. If you didn't sign up, ignore this email.`
        : purpose === "reset"
          ? `Hi ${first},\n\nEnter this code to choose a new password:\n\n${code}\n\nIt expires in 10 minutes. If you didn't ask to reset your password, ignore this email — your password stays the same.`
          : `Hi ${first},\n\nEnter this code to confirm this withdrawal from your workspace wallet:\n\n${opts.summary ?? ""}\n\n${code}\n\nIt only works for exactly this amount and address, and expires in 10 minutes. If you didn't ask for this, don't enter the code — change your password and freeze the wallet.`,
  });
  return { id };
}

/** Checks a code. A wrong guess costs an attempt; the fifth wrong guess retires the code. */
export async function consumeCode(db: DB, userId: string, purpose: CodePurpose, code: string, now = Date.now(), scope = ""): Promise<string> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) throw new CodeError("Enter the 6-digit code from the email.");
  const error = await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, userId)).for("update");
    if (!account) return "No active code. Ask for a new one.";
    const [row] = await tx
      .select()
      .from(s.emailCodes)
      .where(and(eq(s.emailCodes.userId, userId), eq(s.emailCodes.purpose, purpose), isNull(s.emailCodes.consumedAt)))
      .orderBy(desc(s.emailCodes.createdAt))
      .limit(1);
    if (!row) return "No active code. Ask for a new one.";
    if (row.expiresAt.getTime() <= now) return "That code has expired. Ask for a new one.";
    if (row.attempts >= CODE_MAX_ATTEMPTS) return "Too many wrong attempts. Ask for a new code.";
    const ok = timingSafeEqual(Buffer.from(hash(row.id, clean, scope)), Buffer.from(row.codeHash));
    if (!ok) {
      const attempts = row.attempts + 1;
      await tx
        .update(s.emailCodes)
        .set({ attempts, consumedAt: attempts >= CODE_MAX_ATTEMPTS ? new Date(now) : null })
        .where(eq(s.emailCodes.id, row.id));
      // Return errors until after commit: throwing here would roll back the attempt.
      return attempts >= CODE_MAX_ATTEMPTS ? "Too many wrong attempts. Ask for a new code." : `That code isn't right. ${CODE_MAX_ATTEMPTS - attempts} attempt${CODE_MAX_ATTEMPTS - attempts === 1 ? "" : "s"} left.`;
    }
    await tx.update(s.emailCodes).set({ consumedAt: new Date(now) }).where(eq(s.emailCodes.id, row.id));
    return { id: row.id };
  });
  if (typeof error === "string") throw new CodeError(error);
  return error.id;
}
