import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { recordConversion } from "@/server/domain/growth/attribution";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { verifyWebhook } from "@/server/security/hmac";
import { rateLimit, clientIp } from "@/server/security/ratelimit";
import { toMicro } from "@/lib/money";

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
  // 120/min sustained (2/s) with bursts up to 120 — what the Integrations page documents.
  const rl = rateLimit(`events:${ip}`, { capacity: 120, refillPerSec: 2 });
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  const projectId = req.headers.get("x-growthos-project");
  // Reject oversized bodies before buffering them when the sender declares a length.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (!projectId || declared > 20_000) return NextResponse.json({ error: "bad request" }, { status: declared > 20_000 ? 413 : 400 });
  const raw = await req.text();
  if (raw.length > 20_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const db = await getDb();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (!project) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sig = verifyWebhook(project.webhookSecret, raw, req.headers.get("x-growthos-signature"));
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
      // Events sent to a DEMO workspace stay labelled DEMO, never mixed into live metrics.
      dataMode: project.dataMode === "DEMO" ? "DEMO" : "LIVE",
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
