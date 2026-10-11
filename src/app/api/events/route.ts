import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { recordConversion } from "@/server/domain/growth/attribution";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { verifyWebhook } from "@/server/security/hmac";
import { rateLimit, clientIp } from "@/server/security/ratelimit";
import { toMicro } from "@/lib/money";
import { readRequestBody, RequestBodyError } from "@/server/security/request-body";

export const dynamic = "force-dynamic";

const Body = z.object({
  event: z.enum(CONVERSION_EVENTS),
  customName: z.string().max(80).optional(),
  ref: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
  visitorId: z.string().max(200).optional(),
  idempotencyKey: z.string().min(8).max(200),
  occurredAt: z.string().datetime().optional(),
  value: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Signed conversion-event ingestion. HMAC verified against the raw body, 5-minute replay window, idempotent. */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`events:${ip}`, { capacity: 120, refillPerSec: 10 }).ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const projectId = req.headers.get("x-growtendril-project") ?? req.headers.get("x-forage-project") ?? req.headers.get("x-morrowloop-project") ?? req.headers.get("x-growthos-project");
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "bad request" }, { status: 400 });
  let raw: string;
  try { raw = await readRequestBody(req, 20_000); } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const db = await getDb();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (!project || project.dataMode !== "LIVE") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const signature = req.headers.get("x-growtendril-signature") ?? req.headers.get("x-forage-signature") ?? req.headers.get("x-morrowloop-signature") ?? req.headers.get("x-growthos-signature");
  const sig = verifyWebhook(project.webhookSecret, raw, signature);
  if (!sig.ok) return NextResponse.json({ error: `unauthorized: ${sig.reason}` }, { status: 401 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json({ error: "invalid body", detail: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
  try {
    const r = await recordConversion(db, {
      projectId,
      eventType: body.event,
      customName: body.customName,
      referralCode: body.ref,
      visitorId: body.visitorId,
      idempotencyKey: `${projectId}:${body.idempotencyKey}`,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      valueMicro: body.value ? toMicro(body.value) : 0,
      metadata: body.metadata,
      source: "webhook",
      dataMode: "LIVE",
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
