"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { sessionCookieOptions, SESSION_COOKIE, PROJECT_COOKIE } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { currentUser } from "@/server/auth/current";
import { acceptInvite } from "@/server/domain/workspace/members";
import { newId } from "@/server/lib/ids";
import { fail, limited, startSession, type ActionResult } from "@/server/actions/_common";
import { CodeError, consumeCode, issueCode } from "@/server/domain/auth/codes";
import { nextStep, safeNext } from "@/server/auth/next-step";
import { sendEmail } from "@/server/integrations/email";
import { appOrigin } from "@/server/lib/origin";

const Creds = z.object({ email: z.string().trim().email("Enter a valid email").max(200), password: z.string().min(8, "Password must be at least 8 characters").max(200), name: z.string().trim().max(100).optional() });

async function joinInvite(db: Awaited<ReturnType<typeof getDb>>, form: FormData, user: { id: string; email: string }): Promise<string | null> {
  const invite = form.get("invite");
  if (typeof invite !== "string" || !invite) return null;
  const pid = await acceptInvite(db, { token: invite, userId: user.id, userEmail: user.email });
  (await cookies()).set(PROJECT_COOKIE, pid, sessionCookieOptions);
  return pid;
}

const verifyUrl = (invite: FormDataEntryValue | null, next: FormDataEntryValue | null) => {
  const q = new URLSearchParams({ next: safeNext(next) });
  if (typeof invite === "string" && invite) q.set("invite", invite);
  return `/verify?${q}`;
};

export async function loginAction(_: unknown, form: FormData): Promise<ActionResult> {
  let next = "/app";
  try {
    await limited("login", 8, 0.1);
    const c = Creds.parse({ email: form.get("email"), password: form.get("password") });
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.email, c.email.toLowerCase()));
    if (u && !u.isGuest && !u.passwordHash) return { ok: false, error: "This account signs in with Google. Use “Continue with Google”, or reset your password to add one." };
    if (!u || u.isGuest || !u.passwordHash || !verifyPassword(c.password, u.passwordHash)) return { ok: false, error: "Invalid email or password" };
    await startSession(u.id, u.sessionVersion);
    await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, u.id));
    await audit(db, { actorType: "user", actorId: u.id, action: "auth.login" });
    if (!u.emailVerifiedAt) {
      // Signed in but not confirmed yet: send a fresh code (unless one just went out) and ask for it.
      await issueCode(db, u, "verify").catch((e) => {
        if (!(e instanceof CodeError)) throw e;
      });
      next = verifyUrl(form.get("invite"), form.get("next"));
    } else {
      const pid = await joinInvite(db, form, u);
      next = await nextStep(db, u.id, pid, safeNext(form.get("next")));
    }
  } catch (e) {
    return fail(e);
  }
  redirect(next);
}

export async function signupAction(_: unknown, form: FormData): Promise<ActionResult> {
  let next = "/verify";
  try {
    await limited("signup", 5, 0.05);
    const c = Creds.parse({ email: form.get("email"), password: form.get("password"), name: form.get("name") || undefined });
    const db = await getDb();
    const email = c.email.toLowerCase();
    if (email.endsWith("@guest.growthos.local")) return { ok: false, error: "That address is reserved" };
    const [exists] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
    if (exists) return { ok: false, error: "An account with this email exists — sign in instead" };
    const [u] = await db.insert(s.users).values({ id: newId(), email, name: c.name || email.split("@")[0], passwordHash: hashPassword(c.password), lastLoginAt: new Date() }).returning();
    await audit(db, { actorType: "user", actorId: u.id, action: "auth.signup" });
    try {
      await issueCode(db, u, "verify");
    } catch (e) {
      // Don't leave an account nobody can verify: undo it and say why.
      await db.delete(s.users).where(eq(s.users.id, u.id));
      throw e;
    }
    await startSession(u.id, u.sessionVersion);
    next = verifyUrl(form.get("invite"), form.get("next"));
  } catch (e) {
    return fail(e);
  }
  redirect(next);
}

const CodeForm = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code from the email").max(12) });

export async function verifyEmailAction(_: unknown, form: FormData): Promise<ActionResult> {
  let next = "/onboarding";
  try {
    await limited("verify", 10, 0.2);
    const user = await currentUser();
    if (!user) return { ok: false, error: "You are signed out — sign in again." };
    const db = await getDb();
    if (!user.emailVerified) {
      const { code } = CodeForm.parse({ code: form.get("code") });
      await consumeCode(db, user.id, "verify", code);
      await db.update(s.users).set({ emailVerifiedAt: new Date() }).where(eq(s.users.id, user.id));
      await audit(db, { actorType: "user", actorId: user.id, action: "auth.email_verified" });
      const origin = await appOrigin();
      await sendEmail(db, {
        to: user.email,
        userId: user.id,
        kind: "welcome",
        subject: "Welcome to GrowTendril",
        text: `Hi ${user.name.split(" ")[0] || "there"},

Your email is confirmed and your GrowTendril account is ready.

Next: paste your website. GrowTendril reads it, works out who buys from you, and starts finding customers and creators — every payment still asks you first.`,
        action: { label: "Continue", url: `${origin}/app` },
      }).catch(() => undefined);
    }
    const pid = await joinInvite(db, form, user);
    next = await nextStep(db, user.id, pid, safeNext(form.get("next")));
  } catch (e) {
    return fail(e);
  }
  redirect(next);
}

export async function resendCodeAction(): Promise<ActionResult> {
  try {
    await limited("resend-code", 4, 0.02);
    const user = await currentUser();
    if (!user) return { ok: false, error: "You are signed out — sign in again." };
    if (user.emailVerified) return { ok: true, message: "Your email is already confirmed" };
    await issueCode(await getDb(), user, "verify");
    return { ok: true, message: `New code sent to ${user.email}` };
  } catch (e) {
    return fail(e);
  }
}

const EmailOnly = z.object({ email: z.string().trim().email("Enter a valid email").max(200) });

/** Always answers the same way, so it can't be used to find out who has an account. */
export async function forgotPasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  let email = "";
  try {
    await limited("forgot", 5, 0.02);
    email = EmailOnly.parse({ email: form.get("email") }).email.toLowerCase();
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
    if (u && !u.isGuest) {
      // A delivery failure must not reveal that this address has an account. The email
      // integration records failures for operators; callers keep the same recovery response.
      await issueCode(db, u, "reset").catch(() => undefined);
      await audit(db, { actorType: "user", actorId: u.id, action: "auth.reset_requested" });
    }
  } catch (e) {
    return fail(e);
  }
  redirect(`/reset?email=${encodeURIComponent(email)}`);
}

const ResetForm = z.object({
  email: z.string().trim().email("Enter a valid email").max(200),
  code: z.string().trim().min(6, "Enter the 6-digit code from the email").max(12),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function resetPasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    await limited("reset", 8, 0.05);
    const f = ResetForm.parse({ email: form.get("email"), code: form.get("code"), password: form.get("password") });
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.email, f.email.toLowerCase()));
    if (!u || u.isGuest) return { ok: false, error: "That code isn't right. Ask for a new one." };
    await consumeCode(db, u.id, "reset", f.code);
    // A new password signs out every other session, and the code proves the address.
    const [updated] = await db.update(s.users).set({ passwordHash: hashPassword(f.password), sessionVersion: sql`${s.users.sessionVersion} + 1`, emailVerifiedAt: u.emailVerifiedAt ?? new Date(), lastLoginAt: new Date() }).where(eq(s.users.id, u.id)).returning({ version: s.users.sessionVersion });
    await audit(db, { actorType: "user", actorId: u.id, action: "auth.password_reset" });
    await startSession(u.id, updated.version);
  } catch (e) {
    return fail(e);
  }
  redirect("/app");
}

/** Revoke every session for this account, including this one. */
export async function signOutEverywhereAction(): Promise<void> {
  const user = await currentUser();
  if (user) {
    const db = await getDb();
    await db.update(s.users).set({ sessionVersion: sql`${s.users.sessionVersion} + 1` }).where(eq(s.users.id, user.id));
    await audit(db, { actorType: "user", actorId: user.id, action: "auth.sign_out_everywhere" });
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/login?signedout=1");
}

export async function logoutAction(form?: FormData): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  // Only same-site invite pages are allowed as a destination (no open redirect).
  const next = String(form?.get?.("next") ?? "");
  redirect(/^\/invite\/[A-Za-z0-9_-]{10,80}$/.test(next) ? next : "/");
}

export async function switchProjectAction(projectId: string): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const [m] = await db.select().from(s.memberships).where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.userId, user.id)));
  if (!m) throw new Error("You are not a member of that workspace");
  (await cookies()).set(PROJECT_COOKIE, projectId, sessionCookieOptions);
  redirect("/app");
}
