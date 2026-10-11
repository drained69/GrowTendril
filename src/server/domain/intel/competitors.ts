import { z } from "zod";
import { claudeStructured, claudeWebSearch, type WebSource } from "@/server/integrations/llm/claude";
import { readPage, type PageText } from "@/server/domain/intel/crawl";
import { describeLocation, detectLocation, type MarketLocation } from "@/server/domain/intel/location";

/**
 * Competitors come from two places, and nothing reaches the profile unverified:
 *  - "site": named on the product's own pages (comparison links, "alternative to X")
 *  - "web_search": found by Claude's web search, scoped to the business's market. Each one must
 *    appear in the search results the tool actually returned, its website must exist, and for a
 *    local or national business its own pages must not place it in a different country.
 * Founder-entered competitors are kept as written and labelled as such.
 */

export interface CompetitorRecord {
  name: string;
  website: string | null;
  reason: string | null;
  source: "site" | "web_search" | "founder";
  /** verified: the competitor's own pages place it in the same market. search: only the location-scoped search does. */
  locationCheck: "verified" | "search" | "not_applicable";
  locationNote: string | null;
  evidenceUrls: string[];
  siteStatus: "ok" | "blocks_readers" | "unchecked";
}

export interface CompetitorDiscovery {
  competitors: CompetitorRecord[];
  rejected: { name: string; reason: string }[];
  note: string;
}

export const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const sameOrSubdomain = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

const NOT_A_NAME = /^(the|a|an|us|you|your|our|it|them|others?|other tools|spreadsheets?|excel|manual|in-house|diy|competitors?|alternatives?|everyone|anything|more|less|before|now|free)$/i;

/** Competitors the product names itself: /vs/x, /compare/x, /x-alternative links, "alternative to X", "switch from X". */
export function siteNamedCompetitors(pages: PageText[], productName: string, ownHost: string | null): CompetitorRecord[] {
  const found = new Map<string, CompetitorRecord>();
  const own = productName.toLowerCase();
  const add = (raw: string, url: string) => {
    const name = raw.trim().replace(/[.,;:!?)"'’]+$/, "").replace(/^["'‘(]+/, "");
    if (name.length < 2 || name.length > 40 || NOT_A_NAME.test(name) || name.toLowerCase().includes(own) || own.includes(name.toLowerCase())) return;
    const key = name.toLowerCase();
    const rec = found.get(key) ?? { name, website: null, reason: "Named on your own website", source: "site" as const, locationCheck: "not_applicable" as const, locationNote: null, evidenceUrls: [], siteStatus: "unchecked" as const };
    if (!rec.evidenceUrls.includes(url)) rec.evidenceUrls.push(url);
    found.set(key, rec);
  };
  for (const p of pages.filter((x) => x.ok)) {
    for (const l of p.links ?? []) {
      const h = hostOf(l.href);
      if (!h || !ownHost || !sameOrSubdomain(h, ownHost)) continue;
      const path = new URL(l.href).pathname.toLowerCase();
      const m =
        path.match(/\/(?:vs|versus|compare|comparison|alternatives?)\/([a-z0-9][a-z0-9-]{1,38})\/?$/) ??
        path.match(/\/(?:[a-z0-9-]+-)?vs-([a-z0-9][a-z0-9-]{1,38})\/?$/) ??
        path.match(/\/([a-z0-9][a-z0-9-]{1,38})-alternatives?\/?$/);
      if (m) add(l.text && l.text.length <= 40 && !/\b(vs|compare|alternative)\b/i.test(l.text) ? l.text : titleCase(m[1]), l.href);
    }
    const NAME = "([A-Z][\\w.&'-]*(?:\\s[A-Z][\\w.&'-]*){0,2})";
    for (const re of [
      new RegExp(`\\b(?:an? |the )?alternative to ${NAME}`, "g"),
      new RegExp(`\\b${NAME} alternative\\b`, "g"),
      new RegExp(`\\b(?:switch(?:ing)?|migrat(?:e|ing)|mov(?:e|ing)) (?:over )?from ${NAME}`, "g"),
      new RegExp(`\\b(?:vs\\.?|versus|compared to|better than) ${NAME}`, "g"),
    ])
      for (const m of p.text.matchAll(re)) add(m[1], p.url);
  }
  return [...found.values()].slice(0, 8);
}

const CandidateSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().describe("The competitor's brand name"),
        website: z.string().describe("The competitor's own homepage URL, exactly as it appears in the search results"),
        reason: z.string().describe("One sentence: why customers would choose between this and the product"),
        serves: z.string().describe("Where this competitor serves customers, as stated in the search results"),
        evidenceUrls: z.array(z.string()).max(3).describe("Search-result URLs that show this competitor and where it operates"),
      }),
    )
    .max(10),
});

function marketPhrase(loc: MarketLocation): string {
  if (!loc.country) return "its market (location unknown — focus on the most direct competitors)";
  if (loc.scope === "local" && loc.city) return `${loc.city}${loc.region ? `, ${loc.region}` : ""}, ${loc.country} (a local business — competitors must serve the same city or area)`;
  if (loc.scope === "international") return `${loc.country} and internationally (include competitors that serve customers in ${loc.country})`;
  return `${loc.country} (competitors must serve customers in ${loc.country})`;
}

const BLOCKED_STATUS = /^HTTP (401|403|405|406|429|451|503)$/;

/** Checks one web-search candidate against the search results and its own website. */
export async function verifyCandidate(
  c: z.infer<typeof CandidateSchema>["competitors"][number],
  sources: WebSource[],
  loc: MarketLocation,
  ownHost: string | null,
  read: (url: string) => Promise<PageText> = (u) => readPage(u, 6_000),
): Promise<{ ok: true; record: CompetitorRecord } | { ok: false; reason: string }> {
  const host = hostOf(c.website);
  if (!host) return { ok: false, reason: "no usable website" };
  if (ownHost && sameOrSubdomain(host, ownHost)) return { ok: false, reason: "that is your own site" };
  const sourceHosts = sources.map((s) => ({ s, h: hostOf(s.url) }));
  const evidence = [...new Set([...c.evidenceUrls.filter((u) => sources.some((s) => s.url === u)), ...sourceHosts.filter((x) => x.h && sameOrSubdomain(x.h, host)).map((x) => x.s.url)])]
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 3);
  if (!evidence.length) return { ok: false, reason: "not found in the actual search results" };

  const page = await read(`https://${host}/`);
  let siteStatus: CompetitorRecord["siteStatus"] = "ok";
  if (!page.ok) {
    if (page.note && BLOCKED_STATUS.test(page.note)) siteStatus = "blocks_readers";
    else return { ok: false, reason: `website did not load (${page.note ?? "unknown error"})` };
  }

  let locationCheck: CompetitorRecord["locationCheck"] = loc.countryCode ? "search" : "not_applicable";
  let locationNote: string | null = loc.countryCode ? `Found by a search scoped to ${describeLocation(loc)}; serves: ${c.serves}` : null;
  if (page.ok && loc.countryCode) {
    const theirs = detectLocation([page], `https://${host}/`);
    const mentionsOurs = page.text.toLowerCase().includes((loc.city ?? loc.country ?? "").toLowerCase());
    if (theirs.countryCode === loc.countryCode) {
      locationCheck = "verified";
      locationNote = `Its website places it in ${describeLocation(theirs)} (${theirs.evidence[0] ?? "site evidence"})`;
    } else if (mentionsOurs && (loc.city || loc.country)) {
      locationCheck = "verified";
      locationNote = `Its website mentions ${loc.city ?? loc.country}`;
    } else if (theirs.countryCode && theirs.confidence !== "low" && theirs.scope !== "international" && loc.scope !== "international") {
      return { ok: false, reason: `operates in ${theirs.country}, not ${loc.country}` };
    }
  }
  return { ok: true, record: { name: c.name.trim(), website: `https://${host}`, reason: c.reason, source: "web_search", locationCheck, locationNote, evidenceUrls: evidence, siteStatus } };
}

/** Location-scoped competitor research. Without Claude it reports that, rather than guessing. */
export async function discoverCompetitors(input: { name: string; summary: string; category: string; location: MarketLocation; ownUrl: string | null; siteNamed?: CompetitorRecord[] }): Promise<CompetitorDiscovery> {
  const ownHost = hostOf(input.ownUrl);
  const siteNamed = input.siteNamed ?? [];
  const where = marketPhrase(input.location);
  const research = await claudeWebSearch({
    system:
      "You research competitors for a business, using web search. Report only businesses you saw in search results. " +
      "A competitor sells a substitute to the same customers in the same market. Prefer businesses that serve the stated location; " +
      "skip directories, review sites, marketplaces listing many sellers, and news articles. For each competitor give its own homepage URL as shown in the results.",
    user: `Business: ${input.name}\nWhat it does: ${input.summary}\nCategory: ${input.category}\nMarket: ${where}\n${input.ownUrl ? `Its website (not a competitor): ${input.ownUrl}\n` : ""}${siteNamed.length ? `Already known: ${siteNamed.map((s) => s.name).join(", ")}\n` : ""}\nFind up to 8 direct competitors in this market. For each, state its name, homepage, why it competes, and where it serves customers.`,
    location: input.location.countryCode ? { country: input.location.countryCode, region: input.location.region, city: input.location.city } : null,
    maxSearches: 5,
  });
  if (!research.text || !research.sources.length) {
    return { competitors: siteNamed, rejected: [], note: research.error ? `Competitor search unavailable (${research.error}). ${siteNamed.length ? "Showing competitors your site names." : "Add competitors yourself."}` : "Web search returned no results — add competitors yourself." };
  }
  const extracted = await claudeStructured({
    schema: CandidateSchema,
    system: "Extract competitors from research notes. Use only URLs from the provided result list. Never add a competitor the notes do not support.",
    user: `RESEARCH NOTES:\n${research.text}\n\nSEARCH RESULTS (the only allowed URLs):\n${research.sources.map((s) => `- ${s.title} — ${s.url}`).join("\n")}`,
    effort: "low",
  });
  if (!extracted.data) return { competitors: siteNamed, rejected: [], note: `Couldn't structure competitor research (${extracted.error}).` };

  const checked = await Promise.all(extracted.data.competitors.map((c) => verifyCandidate(c, research.sources, input.location, ownHost).then((r) => ({ c, r }))));
  const rejected = checked.flatMap(({ c, r }) => (r.ok ? [] : [{ name: c.name, reason: r.reason }]));
  const verified = checked.flatMap(({ r }) => (r.ok ? [r.record] : []));
  const merged = mergeCompetitors(siteNamed, verified);
  const inMarket = verified.filter((v) => v.locationCheck === "verified").length;
  return {
    competitors: merged,
    rejected,
    note: `${verified.length} competitor(s) found by web search in ${describeLocation(input.location)}${input.location.countryCode ? ` (${inMarket} confirmed by their own website)` : ""}${rejected.length ? `; ${rejected.length} dropped after checks` : ""}.`,
  };
}

export function mergeCompetitors(...lists: CompetitorRecord[][]): CompetitorRecord[] {
  const out = new Map<string, CompetitorRecord>();
  for (const list of lists)
    for (const r of list) {
      const key = hostOf(r.website) ?? r.name.toLowerCase();
      const byName = [...out.values()].find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      const prev = out.get(key) ?? byName;
      if (prev) {
        prev.evidenceUrls = [...new Set([...prev.evidenceUrls, ...r.evidenceUrls])].slice(0, 4);
        if (!prev.website && r.website) Object.assign(prev, { ...r, evidenceUrls: prev.evidenceUrls, source: prev.source });
      } else out.set(key, { ...r });
    }
  return [...out.values()].slice(0, 10);
}

/** Keeps details for names the founder kept, labels new ones as founder-entered, drops the rest. */
export function syncCompetitorDetails(names: string[], details: CompetitorRecord[]): CompetitorRecord[] {
  return names.map(
    (n) =>
      details.find((d) => d.name.toLowerCase() === n.toLowerCase()) ?? { name: n, website: null, reason: null, source: "founder", locationCheck: "not_applicable", locationNote: null, evidenceUrls: [], siteStatus: "unchecked" },
  );
}
