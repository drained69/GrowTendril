import type { PageText } from "@/server/domain/intel/crawl";

/**
 * Where a business operates, inferred only from evidence on its own pages: schema.org addresses,
 * geo meta tags, the country-code domain, phone prefixes, page language/locale, currency and
 * country names in the text. Every conclusion carries the evidence that produced it, and a
 * founder-entered market always overrides detection.
 */

export type MarketScope = "local" | "national" | "international" | "unknown";

export interface MarketLocation {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  scope: MarketScope;
  confidence: "high" | "medium" | "low" | "none";
  source: "detected" | "founder";
  evidence: string[];
}

export const NO_LOCATION: MarketLocation = { countryCode: null, country: null, region: null, city: null, scope: "unknown", confidence: "none", source: "detected", evidence: [] };

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  try {
    const n = regionNames.of(code);
    return n && n !== code ? n : null;
  } catch {
    return null;
  }
}

/** Every ISO-3166 alpha-2 code Intl knows a name for, for the market picker. */
export function allCountries(): { code: string; name: string }[] {
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = countryName(code);
      if (name && !/unknown/i.test(name)) out.push({ code, name });
    }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

const NAME_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of allCountries()) m.set(c.name.toLowerCase(), c.code);
  for (const [alias, code] of Object.entries({ usa: "US", "united states of america": "US", america: "US", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", uae: "AE", "south korea": "KR", "côte d'ivoire": "CI", "ivory coast": "CI", holland: "NL" })) m.set(alias, code);
  return m;
})();

export function toCountryCode(v: unknown): string | null {
  if (typeof v !== "string") {
    if (v && typeof v === "object" && "name" in v) return toCountryCode((v as { name: unknown }).name);
    return null;
  }
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) {
    const up = t.toUpperCase() === "UK" ? "GB" : t.toUpperCase();
    return countryName(up) ? up : null;
  }
  return NAME_TO_CODE.get(t.toLowerCase()) ?? null;
}

/** Country names that are also common words, US states or dishes. */
const AMBIGUOUS_NAMES = new Set(["jersey", "georgia", "chad", "jordan", "turkey", "guinea", "dominica", "china", "panama", "america", "holland", "niger", "chile", "cuba", "iran", "oman", "peru", "togo", "mali", "fiji", "samoa", "monaco", "guernsey", "christmas island", "norfolk island", "réunion", "martinique", "sint maarten"]);

/** ccTLDs that are mostly bought for the letters, not the country. */
const GENERIC_CCTLDS = new Set(["io", "ai", "co", "me", "tv", "app", "ly", "gg", "fm", "sh", "so", "to", "cc", "ws", "is", "it", "im", "la", "vc", "ac", "xyz", "dev", "id", "md", "gl", "ms", "nu", "tk", "ml", "ga", "cf", "gq", "re", "st", "sx", "ps", "ag", "ax", "bz"]);

export function tldCountry(hostname: string): string | null {
  const tld = hostname.toLowerCase().split(".").pop() ?? "";
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
  const code = tld === "uk" ? "GB" : tld.toUpperCase();
  return countryName(code) ? code : null;
}

const DIAL: [string, string][] = [
  ["+234", "NG"], ["+233", "GH"], ["+254", "KE"], ["+27", "ZA"], ["+256", "UG"], ["+255", "TZ"], ["+250", "RW"], ["+251", "ET"], ["+20", "EG"], ["+212", "MA"], ["+225", "CI"], ["+221", "SN"], ["+237", "CM"],
  ["+44", "GB"], ["+353", "IE"], ["+33", "FR"], ["+49", "DE"], ["+34", "ES"], ["+39", "IT"], ["+31", "NL"], ["+32", "BE"], ["+41", "CH"], ["+43", "AT"], ["+46", "SE"], ["+47", "NO"], ["+45", "DK"], ["+358", "FI"], ["+48", "PL"], ["+351", "PT"], ["+30", "GR"], ["+90", "TR"],
  ["+91", "IN"], ["+92", "PK"], ["+880", "BD"], ["+94", "LK"], ["+62", "ID"], ["+60", "MY"], ["+65", "SG"], ["+63", "PH"], ["+66", "TH"], ["+84", "VN"], ["+81", "JP"], ["+82", "KR"], ["+86", "CN"], ["+852", "HK"], ["+886", "TW"],
  ["+61", "AU"], ["+64", "NZ"], ["+971", "AE"], ["+966", "SA"], ["+974", "QA"], ["+972", "IL"], ["+55", "BR"], ["+52", "MX"], ["+54", "AR"], ["+57", "CO"], ["+56", "CL"], ["+51", "PE"],
];

const CURRENCY: [RegExp, string][] = [
  [/₦|\bNGN\b|\bnaira\b/i, "NG"], [/GH₵|\bGHS\b|\bcedis?\b/i, "GH"], [/\bKSh\b|\bKES\b/, "KE"], [/₹|\bINR\b|\brupees?\b/i, "IN"], [/£|\bGBP\b/, "GB"], [/\bZAR\b|\brand\b/i, "ZA"],
  [/\bA\$|\bAUD\b/, "AU"], [/\bC\$|\bCAD\b/, "CA"], [/₱|\bPHP\b/, "PH"], [/\bAED\b|\bdirhams?\b/i, "AE"], [/R\$|\bBRL\b/, "BR"],
];

const INTERNATIONAL = /\b(worldwide|world-wide|ships? (?:internationally|worldwide|globally)|international shipping|customers in \d{2,} countries|in over \d+ countries|global (?:team|customers|reach|payments))\b/i;

type Vote = { code: string; weight: number; why: string };

function addressOf(o: Record<string, unknown>): { country?: string | null; region?: string; city?: string } | null {
  const a = (Array.isArray(o.address) ? o.address[0] : o.address) as Record<string, unknown> | string | undefined;
  if (!a) return null;
  if (typeof a === "string") return { country: null, city: undefined, region: undefined };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { country: toCountryCode(a.addressCountry), region: str(a.addressRegion), city: str(a.addressLocality) };
}

const LOCAL_TYPES = /(LocalBusiness|Store|Restaurant|FoodEstablishment|Cafe|Bakery|BarOrPub|Hotel|LodgingBusiness|MedicalBusiness|Dentist|Clinic|Physician|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|ExerciseGym|SportsActivityLocation|AutomotiveBusiness|AutoRepair|HomeAndConstructionBusiness|Plumber|Electrician|LegalService|Attorney|RealEstateAgent|EducationalOrganization|School|ChildCare|ProfessionalService|FinancialService|TravelAgency|EntertainmentBusiness)/;

export function detectLocation(pages: PageText[], siteUrl?: string | null): MarketLocation {
  const ok = pages.filter((p) => p.ok);
  const votes: Vote[] = [];
  let city: string | null = null;
  let region: string | null = null;
  let localType = false;
  let physicalAddress = false;
  const intl = new Set<string>();

  for (const p of ok) {
    for (const o of p.jsonLd ?? []) {
      const type = String(Array.isArray(o["@type"]) ? o["@type"].join(",") : o["@type"]);
      if (LOCAL_TYPES.test(type)) localType = true;
      const addr = addressOf(o);
      if (addr) {
        physicalAddress = true;
        if (addr.country) votes.push({ code: addr.country, weight: 6, why: `schema.org address on ${new URL(p.url).pathname || "/"}` });
        city ??= addr.city ?? null;
        region ??= addr.region ?? null;
      }
      const served = o.areaServed;
      for (const a of Array.isArray(served) ? served : served ? [served] : []) {
        const c = toCountryCode(a);
        if (c) votes.push({ code: c, weight: 3, why: `schema.org areaServed "${typeof a === "string" ? a : c}"` });
      }
    }
    const m = p.meta ?? {};
    const geo = m["geo.region"];
    if (geo) {
      const c = toCountryCode(geo.split("-")[0]);
      if (c) votes.push({ code: c, weight: 5, why: `geo.region meta "${geo}"` });
    }
    if (m["geo.placename"]) city ??= m["geo.placename"].split(",")[0].trim() || null;
    for (const l of [p.lang, m["og:locale"]?.replace("_", "-")]) {
      const c = l?.split("-")[1];
      const code = c ? toCountryCode(c) : null;
      // en-US is the default of most site builders, so it says little on its own.
      if (code) votes.push({ code, weight: code === "US" ? 0.5 : 2, why: `page locale "${l}"` });
    }
    for (const h of p.hreflang ?? []) {
      const c = h.split("-")[1];
      if (c && toCountryCode(c)) intl.add(toCountryCode(c)!);
    }
    const text = p.text;
    for (const [prefix, code] of DIAL) {
      const re = new RegExp(`\\${prefix}[\\s(.-]*\\d`, "g");
      const n = text.match(re)?.length ?? 0;
      if (n) votes.push({ code, weight: Math.min(n, 2) * 1.5, why: `phone number with ${prefix}` });
    }
    for (const [re, code] of CURRENCY) if (re.test(text)) votes.push({ code, weight: 1.5, why: `prices in ${re.exec(text)![0].trim()}` });
    if (INTERNATIONAL.test(text)) intl.add("*");
  }

  for (const p of ok.slice(0, 4)) {
    const lower = p.text.toLowerCase();
    for (const [name, code] of NAME_TO_CODE) {
      if (name.length < 4 || AMBIGUOUS_NAMES.has(name)) continue;
      const n = lower.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"))?.length ?? 0;
      if (n) votes.push({ code, weight: Math.min(n, 3) * 0.6, why: `mentions "${name}"` });
    }
  }

  const host = siteUrl ? (() => { try { return new URL(/^https?:/i.test(siteUrl) ? siteUrl : `https://${siteUrl}`).hostname; } catch { return null; } })() : null;
  const tld = host ? tldCountry(host) : null;
  if (tld) votes.push({ code: tld, weight: 3, why: `.${host!.split(".").pop()} domain` });

  if (!votes.length) return { ...NO_LOCATION, scope: intl.size > 1 || intl.has("*") ? "international" : "unknown", evidence: intl.has("*") ? ["says it serves customers internationally"] : [] };

  const tally = new Map<string, { w: number; why: string[] }>();
  for (const v of votes) {
    const t = tally.get(v.code) ?? { w: 0, why: [] };
    t.w += v.weight;
    if (!t.why.includes(v.why)) t.why.push(v.why);
    tally.set(v.code, t);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1].w - a[1].w);
  const [code, best] = ranked[0];
  const runnerUp = ranked[1]?.[1].w ?? 0;
  const margin = best.w - runnerUp;
  const confidence: MarketLocation["confidence"] = best.w >= 6 && margin >= 3 ? "high" : best.w >= 3 && margin >= 1.5 ? "medium" : "low";
  const international = intl.has("*") || [...intl].filter((c) => c !== "*").length >= 3;
  const scope: MarketScope = international ? "international" : (localType || physicalAddress) && city ? "local" : "national";
  return {
    countryCode: code,
    country: countryName(code),
    region,
    city,
    scope,
    confidence,
    source: "detected",
    evidence: [...best.why.slice(0, 5), ...(international ? ["says it serves customers internationally"] : [])],
  };
}

export function describeLocation(l: MarketLocation): string {
  const place = [l.city, l.region, l.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
  if (!place) return l.scope === "international" ? "International" : "Not detected";
  return l.scope === "international" ? `${place} · serves international customers` : place;
}
