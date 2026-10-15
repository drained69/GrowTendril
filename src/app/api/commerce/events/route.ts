import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/server/db/client";
import { ingestCommerce } from "@/server/domain/growth/commerce";
import { verifyWebhook } from "@/server/security/hmac";
import { readRequestBody, RequestBodyError } from "@/server/security/request-body";
import { clientIp, rateLimit } from "@/server/security/ratelimit";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`commerce:${clientIp(req.headers)}`, { capacity: 30, refillPerSec: 0.5 }).ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const projectId = req.headers.get("x-growtendril-project");
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let raw: string;
  try { raw = await readRequestBody(req, 20_000); } catch (e) { return NextResponse.json({ error: "invalid body" }, { status: e instanceof RequestBodyError ? e.status : 400 }); }
  const db = await getDb();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (!project || project.dataMode !== "LIVE" || !verifyWebhook(project.webhookSecret, raw, req.headers.get("x-growtendril-signature")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await ingestCommerce(db, projectId, JSON.parse(raw)) }); }
  catch { return NextResponse.json({ error: "Payment could not be verified or its order history is incomplete. Retry with the authorization and subsequent event log pointers." }, { status: 422 }); }
}
