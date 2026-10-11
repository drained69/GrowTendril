import { ProviderError, type ProviderId } from "@/server/integrations/providers/types";

export const USER_AGENT = "GrowTendril/0.1 (+https://github.com/drained69/GrowTendril; research bot; respects robots.txt)";

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
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  return (await res.json()) as T;
}

export const stripHtml = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
