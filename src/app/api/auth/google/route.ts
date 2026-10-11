import { NextResponse } from "next/server";
import { authorizeUrl, googleConfigured, newOAuthState, OAUTH_COOKIE, packState } from "@/server/auth/google";
import { appOrigin } from "@/server/lib/origin";
import { safeNext } from "@/server/auth/next-step";

export const dynamic = "force-dynamic";

/** Start "Continue with Google": remember where to go next, then hand over to Google. */
export async function GET(req: Request) {
  const origin = await appOrigin();
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/login?error=google_unavailable`);
  const q = new URL(req.url).searchParams;
  const next = q.get("next") ?? "";
  const invite = q.get("invite");
  const st = newOAuthState(safeNext(next), invite && /^[A-Za-z0-9_-]{10,80}$/.test(invite) ? invite : null);
  const res = NextResponse.redirect(authorizeUrl(st, `${origin}/api/auth/google/callback`));
  res.cookies.set(OAUTH_COOKIE, packState(st), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 });
  return res;
}
