import { eq } from "drizzle-orm";
import { getDb, schema as s } from "../src/server/db/client";
import { signWebhook } from "../src/server/security/hmac";
/** Sends signed / tampered / replayed conversion events to a running server. */
const db = await getDb();
const [camp] = await db.select({ code: s.campaigns.referralCode, pid: s.experiments.projectId }).from(s.campaigns).innerJoin(s.experiments, eq(s.campaigns.experimentId, s.experiments.id)).limit(1);
const [p] = await db.select().from(s.projects).where(eq(s.projects.id, camp.pid));
const base = process.env.BASE || "http://localhost:3000";
const body = JSON.stringify({ event: "sdk_key_created", ref: camp.code, visitorId: "e2e-user-1", idempotencyKey: `e2e-${Date.now()}` });
const send = (b: string, sig: string) => fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json", "x-growtendril-project": p.id, "x-growtendril-signature": sig }, body: b }).then(async (r) => `${r.status} ${await r.text()}`);
console.log("valid:   ", await send(body, signWebhook(p.webhookSecret, body)));
console.log("replay:  ", await send(body, signWebhook(p.webhookSecret, body)));
console.log("tampered:", await send(body.replace("e2e-user-1", "attacker"), signWebhook(p.webhookSecret, body)));
console.log("stale:   ", await send(body, signWebhook(p.webhookSecret, body, Math.floor(Date.now() / 1000) - 3600)));
const r = await fetch(`${base}/r/${camp.code}`, { redirect: "manual" });
console.log("redirect:", r.status, r.headers.get("location"));
process.exit(0);
