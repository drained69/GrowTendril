import { platformCustody } from "@/server/integrations/circle/config";

/**
 * Does Circle actually accept this deployment's API key? `platformCustody()` only checks the key's
 * format, so a revoked or wrong-account key looked healthy while every wallet call failed.
 * One cheap read-only call, cached for 10 minutes so health checks stay fast.
 */
export type CircleAuth = "ok" | "rejected" | "unreachable" | "off";
const TTL_MS = 10 * 60_000;
let cache: { at: number; value: CircleAuth } | null = null;
let inflight: Promise<CircleAuth> | null = null;

export async function circleAuth(now = Date.now()): Promise<CircleAuth> {
  if (platformCustody() !== "circle") return "off";
  if (cache && now - cache.at < TTL_MS) return cache.value;
  inflight ??= (async () => {
    try {
      const r = await fetch("https://api.circle.com/v1/w3s/config/entity/publicKey", { headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` }, signal: AbortSignal.timeout(4_000) });
      return r.ok ? "ok" : r.status === 401 || r.status === 403 ? "rejected" : "unreachable";
    } catch {
      return "unreachable" as const;
    }
  })().then((value) => {
    cache = { at: Date.now(), value };
    inflight = null;
    return value;
  });
  return inflight;
}
