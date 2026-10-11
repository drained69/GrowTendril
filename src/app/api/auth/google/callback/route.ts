import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { exchangeCode, googleConfigured, OAUTH_COOKIE, unpackState } from "@/server/auth/google";
import { createSessionToken, PROJECT_COOKIE, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { nextStep } from "@/server/auth/next-step";
import { acceptInvite } from "@/server/domain/workspace/members";
import { sendEmail } from "@/server/integrations/email";
import { appOrigin } from "@/server/lib/origin";
import { googleAccount } from "@/server/domain/auth/google-account";
import { rateLimit, clientIp } from "@/server/security/ratelimit";

export const dynamic = "force-dynamic";

/** Google sends people back here. Finds, links or creates the account, then signs them in. */
export async function GET(req: Request) {
  const origin = await appOrigin();
  const back = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return res;
  };
  if (!googleConfigured()) return back("/login?error=google_unavailable");
  if (!rateLimit(`google-cb:${clientIp(req.headers)}`, { capacity: 10, refillPerSec: 0.1 }).ok) return back("/login?error=google_rate");
  const q = new URL(req.url).searchParams;
  const st = unpackState(req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([^;]+)`))?.[1]);
  if (q.get("error")) return back("/login?error=google_canceled");
  if (!st || !q.get("code") || q.get("state") !== st.state) return back("/login?error=google_state");

  let identity;
  try {
    identity = await exchangeCode(q.get("code")!, st.verifier, `${origin}/api/auth/google/callback`);
  } catch (e) {
    console.warn(`[google] ${(e as Error).message}`);
    return back("/login?error=google_failed");
  }

  const db = await getDb();
  let account;
  try { account = await googleAccount(db, identity); } catch { return back("/login?error=google_failed"); }
  const { user, created } = account;
  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, user.id));
  await audit(db, { actorType: "user", actorId: user.id, action: created ? "auth.signup_google" : "auth.login_google" });
  if (created) {
    await sendEmail(db, {
      to: user.email,
      userId: user.id,
      kind: "welcome",
      subject: "Welcome to GrowTendril",
      text: `Hi ${user.name.split(" ")[0] || "there"},\n\nYour GrowTendril account is ready — you signed up with Google, so there's no password to remember.\n\nNext: paste your website. GrowTendril reads it, works out who buys from you, and starts finding customers and creators.`,
      action: { label: "Continue", url: `${origin}/app` },
    }).catch(() => undefined);
  }

  let invited: string | null = null;
  if (st.invite) {
    try {
      invited = await acceptInvite(db, { token: st.invite, userId: user.id, userEmail: user.email });
    } catch (e) {
      const res = back(`/invite/${st.invite}?error=${encodeURIComponent((e as Error).message.slice(0, 160))}`);
      res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, user.sessionVersion), sessionCookieOptions);
      return res;
    }
  }
  const res = back(await nextStep(db, user.id, invited, st.next));
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, user.sessionVersion), sessionCookieOptions);
  if (invited) res.cookies.set(PROJECT_COOKIE, invited, sessionCookieOptions);
  return res;
}
