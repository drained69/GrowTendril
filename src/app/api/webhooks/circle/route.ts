import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { transition } from "@/server/domain/agent/ledger";
import { writeReceipt } from "@/server/domain/agent/decisions";
import { readRequestBody, RequestBodyError } from "@/server/security/request-body";
import { clientIp, rateLimit } from "@/server/security/ratelimit";

export const dynamic = "force-dynamic";

const keyCache = new Map<string, string>();
const Event = z.object({ notificationType: z.string().max(100).optional(), notification: z.object({ txHash: z.string().max(200).nullish(), state: z.string().max(50).nullish() }).optional() });

/** Circle signs notifications with ECDSA; the public key is fetched by key id from Circle's API. */
async function circlePublicKey(keyId: string): Promise<string> {
  if (keyCache.has(keyId)) return keyCache.get(keyId)!;
  const r = await fetch(`https://api.circle.com/v2/notifications/publicKey/${encodeURIComponent(keyId)}`, { headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`public key fetch ${r.status}`);
  const j = (await r.json()) as { data: { publicKey: string } };
  keyCache.set(keyId, j.data.publicKey);
  if (keyCache.size > 128) keyCache.delete(keyCache.keys().next().value!);
  return j.data.publicKey;
}

export async function POST(req: Request) {
  if (!rateLimit(`circle:${clientIp(req.headers)}`, { capacity: 120, refillPerSec: 5 }).ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  let raw: string;
  try { raw = await readRequestBody(req, 100_000); } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  // Circle sends a HEAD/empty probe when registering the endpoint.
  if (!raw) return NextResponse.json({ ok: true });
  const sig = req.headers.get("x-circle-signature");
  const keyId = req.headers.get("x-circle-key-id");
  if (!sig || sig.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig) || !keyId || !/^[A-Za-z0-9_-]{1,128}$/.test(keyId) || !process.env.CIRCLE_API_KEY) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const pub = createPublicKey({ key: Buffer.from(await circlePublicKey(keyId), "base64"), format: "der", type: "spki" });
    if (!verify("sha256", Buffer.from(raw), pub, Buffer.from(sig, "base64"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "verification failed" }, { status: 401 });
  }
  let evt: z.infer<typeof Event>;
  try { evt = Event.parse(JSON.parse(raw)); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const db = await getDb();
  await audit(db, { actorType: "webhook", actorId: "circle", action: `circle.${evt.notificationType ?? "unknown"}`, data: { state: evt.notification?.state, txHash: evt.notification?.txHash } });
  const hash = evt.notification?.txHash;
  if (hash && evt.notification?.state) {
    const [tx] = await db.select().from(s.transactions).where(and(eq(s.transactions.txHash, hash), eq(s.transactions.state, "SUBMITTED")));
    if (tx && ["COMPLETE", "CONFIRMED"].includes(evt.notification.state)) await transition(db, tx.id, "SETTLED", {}, `Circle webhook: ${evt.notification.state}`);
    if (tx && ["FAILED", "DENIED", "CANCELLED"].includes(evt.notification.state)) await transition(db, tx.id, "FAILED", { error: `Circle: ${evt.notification.state}` });
    if (tx) await writeReceipt(db, tx.decisionId);
  }
  return NextResponse.json({ ok: true });
}
