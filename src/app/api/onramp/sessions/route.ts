import { createOnrampServerKit, createSessionRouteHandler } from "@circle-fin/onramp-kit/server";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, verifySessionToken } from "@/server/auth/session";
import { getDb, schema as s } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Arc Onramp session minting — only for a signed-in founder, only when ONRAMP_API_KEY is set. */
export async function POST(req: Request) {
  if (!process.env.ONRAMP_API_KEY) return Response.json({ error: "Onramp not configured (ONRAMP_API_KEY)" }, { status: 501 });
  const handler = createSessionRouteHandler(createOnrampServerKit({ apiKey: process.env.ONRAMP_API_KEY }), {
    authorize: async (request: Request) => {
      const cookie = request.headers.get("cookie") ?? "";
      const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split("=")[1];
      const sess = verifySessionToken(token ? decodeURIComponent(token) : null);
      if (!sess) return false;
      // Same rules as every page: a current (not revoked) session on a verified account.
      const [u] = await (await getDb()).select({ v: s.users.sessionVersion, verified: s.users.emailVerifiedAt, guest: s.users.isGuest }).from(s.users).where(eq(s.users.id, sess.uid));
      return !!u && !u.guest && !!u.verified && u.v === sess.v;
    },
  } as Parameters<typeof createSessionRouteHandler>[1]);
  return handler(req);
}
