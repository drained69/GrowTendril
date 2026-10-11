import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, schema as s } from "@/server/db/client";
import { recordConversion } from "@/server/domain/growth/attribution";
import { buildUtmUrl } from "@/server/domain/growth/attribution-links";
import { rateLimit, clientIp } from "@/server/security/ratelimit";

export const dynamic = "force-dynamic";

/** Tracked short link: records a first-party "visit" for the campaign, then redirects with UTM + gt_ref. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[a-z0-9]{6,16}$/.test(code)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  const [camp] = await db.select().from(s.campaigns).where(eq(s.campaigns.referralCode, code));
  if (!camp) return new NextResponse("Not found", { status: 404 });
  const [exp] = await db.select({ projectId: s.experiments.projectId, mode: s.projects.dataMode }).from(s.experiments).innerJoin(s.projects, eq(s.experiments.projectId, s.projects.id)).where(eq(s.experiments.id, camp.experimentId));
  if (!exp) return new NextResponse("Not found", { status: 404 });
  const dest = buildUtmUrl(camp.destinationUrl, { source: camp.utmSource, medium: camp.utmMedium, campaign: camp.utmCampaign, ref: camp.referralCode });
  const res = NextResponse.redirect(dest, 302);
  // Rate-limited and de-duplicated per visitor cookie so refreshes and bots don't inflate visits.
  const ip = clientIp(req.headers);
  if (rateLimit(`r:${ip}`, { capacity: 30, refillPerSec: 0.5 }).ok && !/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") ?? "")) {
    const cookie = req.headers.get("cookie")?.match(/(?:gt|gos)_vid=([a-f0-9-]{36})/)?.[1];
    const visitor = cookie ?? randomUUID();
    // A click on a DEMO workspace's link is still labelled DEMO: its campaign and results are fictional.
    await recordConversion(db, { projectId: exp.projectId, eventType: "visit", referralCode: code, visitorId: visitor, idempotencyKey: `visit:${code}:${visitor}`, source: "redirect", dataMode: exp.mode === "DEMO" ? "DEMO" : "LIVE" });
    if (!cookie) res.cookies.set("gt_vid", visitor, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 90, path: "/" });
  }
  return res;
}
