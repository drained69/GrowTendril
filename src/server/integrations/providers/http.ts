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

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201D", ldquo: "\u201C",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", copy: "\u00A9", reg: "\u00AE", trade: "\u2122", euro: "\u20AC", pound: "\u00A3",
  yen: "\u00A5", cent: "\u00A2", middot: "\u00B7", bull: "\u2022", times: "\u00D7", deg: "\u00B0",
};

// &eacute; &Uuml; &ntilde; … built from base letter + combining mark.
const MARKS: Record<string, string> = { acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", tilde: "\u0303", cedil: "\u0327", ring: "\u030A" };
for (const [mark, comb] of Object.entries(MARKS))
  for (const letter of "aeiouycnAEIOUYCN") {
    const ch = (letter + comb).normalize("NFC");
    if (ch.length === 1) NAMED_ENTITIES[`${letter}${mark}`] = ch;
  }
Object.assign(NAMED_ENTITIES, { szlig: "\u00DF", aelig: "\u00E6", AElig: "\u00C6", oslash: "\u00F8", Oslash: "\u00D8", iexcl: "\u00A1", iquest: "\u00BF", laquo: "\u00AB", raquo: "\u00BB", sect: "\u00A7", para: "\u00B6", frac12: "\u00BD", naira: "\u20A6" });

/** Decodes named (common set) and numeric HTML entities; unknown names are left as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e] ?? NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const stripHtml = (s: string) =>
  decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v\u00A0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
