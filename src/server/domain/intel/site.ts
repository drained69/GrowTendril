import { readPage, type PageText } from "@/server/domain/intel/crawl";
import { publicUrl } from "@/server/security/public-http";

/**
 * Reads a business website the way a new marketer would: the homepage plus a few pages
 * that explain the offer (about, pricing, features, menu…), then pulls out the facts
 * onboarding needs. Everything here comes from the site itself — nothing is guessed.
 */

export interface SocialProfiles {
  x?: string;
  github?: string;
  bluesky?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
  facebook?: string;
}

export interface SiteFacts {
  url: string;
  host: string;
  name: string;
  description: string;
  location: string | null;
  socials: SocialProfiles;
  competitors: string[];
  readablePages: number;
  readableChars: number;
}

const KEY_PAGES = /\/(about|about-us|our-story|story|pricing|plans|features|product|products|services|menu|shop|how-it-works|solutions|faq|what-we-do)\/?$/i;

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  const u = publicUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!u.hostname.includes(".")) throw new Error("Enter a full website address, like example.com");
  u.hash = "";
  return u.toString();
}

/** Same-site pages worth reading, shortest (most canonical) paths first. */
export function keyPageLinks(home: PageText, max = 3): string[] {
  const base = new URL(home.url);
  const seen = new Set<string>();
  return (home.links ?? [])
    .map((l) => new URL(l))
    .filter((u) => u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "") && KEY_PAGES.test(u.pathname))
    .map((u) => `${u.origin}${u.pathname.replace(/\/$/, "")}`)
    .filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .sort((a, b) => a.length - b.length)
    .slice(0, max);
}

export async function crawlSite(url: string): Promise<{ home: PageText; pages: PageText[] }> {
  const home = await readPage(url);
  if (!home.ok) return { home, pages: [home] };
  const extra = await Promise.all(keyPageLinks(home).map((l) => readPage(l, 8_000)));
  return { home, pages: [home, ...extra] };
}

const SOCIAL_PATTERNS: [keyof SocialProfiles, RegExp][] = [
  ["x", /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?!intent|share|home|search|i\/)(@?[A-Za-z0-9_]{1,15})\/?$/i],
  ["github", /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+(?:\/[A-Za-z0-9_.-]+)?)\/?$/i],
  ["bluesky", /^https?:\/\/bsky\.app\/profile\/([A-Za-z0-9.:-]+)\/?$/i],
  ["instagram", /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?$/i],
  ["tiktok", /^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)\/?$/i],
  ["youtube", /^https?:\/\/(?:www\.)?youtube\.com\/((?:@|channel\/|c\/)[A-Za-z0-9_.-]+)\/?$/i],
  ["linkedin", /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(company\/[A-Za-z0-9_-]+)\/?$/i],
  ["facebook", /^https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.]+)\/?$/i],
];

export function socialProfiles(links: string[]): SocialProfiles {
  const out: SocialProfiles = {};
  for (const link of links) {
    const clean = link.split("?")[0];
    for (const [key, re] of SOCIAL_PATTERNS) {
      const m = clean.match(re);
      if (m && !out[key] && !/^(sharer|share|login|signup)$/i.test(m[1])) out[key] = key === "x" ? m[1].replace(/^@/, "") : key === "github" ? `https://github.com/${m[1]}` : m[1];
    }
  }
  return out;
}

type Ld = Record<string, unknown>;
const ldTypes = (b: Ld) => [b["@type"]].flat().map(String);
const isOrg = (b: Ld) => ldTypes(b).some((t) => /Organization|LocalBusiness|Store|Restaurant|Bakery|Product|SoftwareApplication|WebSite|Brand|Service/.test(t));

/** "Acme — Fresh bread delivered | Austin" → "Acme"; falls back to the domain label. */
export function siteName(home: PageText): string {
  const ld = (home.jsonLd ?? []).filter((b): b is Ld => !!b && typeof b === "object").find((b) => isOrg(b) && typeof b.name === "string");
  if (ld) return String(ld.name).trim();
  if (home.siteName) return home.siteName.trim();
  const host = new URL(home.url).hostname.replace(/^www\./, "");
  const label = host.split(".")[0];
  const parts = (home.title ?? "").split(/\s+[|·•–—-]\s+|:\s+/).map((p) => p.trim()).filter(Boolean);
  const match = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(label.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (match && match.length <= 40) return match;
  if (parts[0] && parts[0].length <= 30 && parts.length > 1) return parts[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function siteLocation(home: PageText): string | null {
  for (const b of home.jsonLd ?? []) {
    const raw = (b as Ld)?.address;
    const addr = (Array.isArray(raw) ? raw[0] : raw) as Ld | undefined;
    if (!addr || typeof addr !== "object") continue;
    const clean = (value: unknown) => typeof value === "string" && value.trim().length <= 80 ? value.trim() : null;
    const city = clean(addr.addressLocality);
    const region = clean(addr.addressRegion);
    const rawCountry = typeof addr.addressCountry === "object" && addr.addressCountry !== null ? (addr.addressCountry as Ld).name : addr.addressCountry;
    const country = clean(rawCountry);
    const countryName = country && /^[A-Za-z]{2}$/.test(country) ? new Intl.DisplayNames(["en"], { type: "region" }).of(country.toUpperCase()) ?? country : country;
    const parts = [city, region, countryName].filter((part): part is string => !!part).filter((part, index, list) => list.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index);
    if (parts.length) return parts.join(", ");
  }
  // A postal address in the footer: "… San Francisco, CA 94110".
  const us = home.text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (us && US_STATES.has(us[2])) return `${us[1]}, ${us[2]}`;
  return null;
}

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));

/** Competitors the site names itself: /vs/x, /compare/x, /alternatives/x, "alternative to X". */
export function namedCompetitors(pages: PageText[], ownName: string): string[] {
  const own = ownName.toLowerCase();
  const out = new Set<string>();
  const invalid = /^(the|a|an|us|you|your|our|it|others?|other tools|spreadsheets?|excel|manual|in-house|diy|competitors?|alternatives?|everyone)$/i;
  for (const p of pages) {
    for (const l of p.links ?? []) {
      let link: URL;
      try { link = new URL(l, p.url); } catch { continue; }
      if (link.hostname.replace(/^www\./, "") !== new URL(p.url).hostname.replace(/^www\./, "")) continue;
      const slug = link.pathname.match(/\/(?:vs|versus|compare|comparison|alternatives?)\/([a-z0-9][a-z0-9-]{1,38})\/?$/i)?.[1]
        ?? link.pathname.match(/\/vs-([a-z0-9][a-z0-9-]{1,38})\/?$/i)?.[1]
        ?? link.pathname.match(/\/([a-z0-9][a-z0-9-]{1,38})-alternatives?\/?$/i)?.[1];
      if (slug) out.add(slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
    for (const m of `${p.headings.join(". ")}. ${p.text.slice(0, 6000)}`.matchAll(/\b(?:alternative to|better than|switch(?:ing)? from)\s+([A-Z][A-Za-z0-9.&]+(?:\s[A-Z][A-Za-z0-9.&]+)?)/g)) out.add(m[1]);
  }
  return [...out].filter((c) => c.toLowerCase() !== own && !invalid.test(c) && c.length > 1).slice(0, 6);
}

export function siteFacts(home: PageText, pages: PageText[]): SiteFacts {
  const readable = pages.filter((p) => p.ok);
  const name = siteName(home);
  const firstSentence = home.text.split(/(?<=[.!?])\s/).find((x) => x.length > 40 && x.length < 300);
  // No meta description: a long title tagline ("Acme – We bake …") says more than a nav heading like "Home".
  const tagline = (home.title ?? "").split(/\s+[|·•–—-]\s+/).slice(1).find((x) => x.length >= 30);
  const heading = home.headings.find((h) => h.length > 12 && !/^(home|menu|welcome|shop|cart|search|log ?in|sign ?in)\b/i.test(h));
  const description = (home.description ?? readable.find((p) => p.description)?.description ?? tagline ?? [heading, firstSentence].filter(Boolean).join(". ")).trim();
  return {
    url: home.url,
    host: new URL(home.url).hostname.replace(/^www\./, ""),
    name,
    description,
    location: [home, ...readable.filter((page) => page.url !== home.url)].map(siteLocation).find(Boolean) ?? null,
    socials: socialProfiles(readable.flatMap((p) => p.links ?? []).concat((home.jsonLd ?? []).flatMap((b) => [(b as Ld)?.sameAs ?? []].flat().map(String)))),
    competitors: namedCompetitors(readable, name),
    readablePages: readable.length,
    readableChars: readable.reduce((n, p) => n + p.text.length, 0),
  };
}
