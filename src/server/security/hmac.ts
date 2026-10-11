import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Conversion webhook signature: header `x-growtendril-signature: t=<unix>,v1=<hex hmac>` where
 * hmac = HMAC-SHA256(secret, `${t}.${rawBody}`). Rejects stale timestamps (replay window 5 min).
 */
export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function verifyWebhook(secret: string, body: string, header: string | null, toleranceS = 300): { ok: boolean; reason?: string } {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) return { ok: false, reason: "malformed signature" };
  if (Math.abs(Date.now() / 1000 - t) > toleranceS) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
