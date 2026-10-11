import { ProviderError, type ProviderId } from "@/server/integrations/providers/types";

export const USER_AGENT = "GrowTendril/0.1 (+https://growtendril.xyz; research bot; respects robots.txt)";

/** fetch with timeout and a clear provider-scoped error. Rate limits surface as errors, never retried blindly. */
export async function getJson<T>(provider: ProviderId, url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: unknown) => {
    throw new ProviderError(provider, `network error: ${(e as Error).message}`);
  });
  if (res.status === 429) throw new ProviderError(provider, "rate limited (429) — backing off until next cycle", 429);
  if (res.status === 402) throw new ProviderError(provider, "HTTP 402: this API account has no credits left — add credits with the provider or remove the key", 402);
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return (await res.json()) as T;
}

const NAMED = { ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™" };
const safeChar = (n: number) => (n > 31 && n < 0x110000 && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : " ");

export const stripHtml = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d{1,7});/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&(ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip|middot|bull|copy|reg|trade);/g, (_, n: keyof typeof NAMED) => NAMED[n])
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
