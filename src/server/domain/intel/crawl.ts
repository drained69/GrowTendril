import { decodeEntities, stripHtml, USER_AGENT } from "@/server/integrations/providers/http";
import { checkUrl, safeFetch, UnsafeUrlError } from "@/server/security/safe-fetch";

/**
 * Polite public-page reader for product onboarding. Honors robots.txt (User-agent: *),
 * one request per page, short timeouts, text only. URLs are user-supplied, so every request
 * goes through safeFetch (public addresses only, redirects re-validated).
 */

const robotsCache = new Map<string, string[]>();

async function disallowedPaths(origin: string): Promise<string[]> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  let rules: string[] = [];
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 6000, maxBytes: 200_000 });
    if (r.ok) {
      let applies = false;
      for (const raw of r.body.split("\n")) {
        const line = raw.split("#")[0].trim();
        const [k, ...rest] = line.split(":");
        const v = rest.join(":").trim();
        if (/^user-agent$/i.test(k)) applies = v === "*" || /growtendril|growthos/i.test(v);
        else if (applies && /^disallow$/i.test(k) && v) rules.push(v);
      }
    }
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
  return rules;
}

export interface PageLink {
  href: string;
  text: string;
}

export interface PageText {
  url: string;
  ok: boolean;
  title?: string;
  description?: string;
  headings: string[];
  text: string;
  note?: string;
  /** <html lang>, e.g. "en-GB". */
  lang?: string;
  /** Every <meta name|property|itemprop> on the page, lower-cased keys (first value wins). */
  meta?: Record<string, string>;
  /** Flattened schema.org objects from JSON-LD blocks (@graph and arrays unwrapped). */
  jsonLd?: Record<string, unknown>[];
  /** hreflang values of alternate-language links. */
  hreflang?: string[];
  /** Absolute links found on the page. */
  links?: PageLink[];
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) out[m[1].toLowerCase()] ??= decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    const key = (a.name ?? a.property ?? a.itemprop ?? (a["http-equiv"] ? `http-equiv:${a["http-equiv"]}` : ""))?.toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = oneLine(a.content);
  }
  return meta;
}

function flattenLd(node: unknown, out: Record<string, unknown>[], depth = 0) {
  if (depth > 4 || node == null) return;
  if (Array.isArray(node)) return node.forEach((n) => flattenLd(n, out, depth + 1));
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["@graph"])) flattenLd(o["@graph"], out, depth + 1);
  if (o["@type"]) out.push(o);
}

export function parseJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      flattenLd(JSON.parse(m[1].trim()), out);
    } catch {
      // Malformed JSON-LD is common; skip the block rather than guess.
    }
  }
  return out.slice(0, 40);
}

export function parseLinks(html: string, base: URL): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = parseAttrs(m[1]).href;
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: key, text: oneLine(stripHtml(m[2])).slice(0, 120) });
    if (out.length >= 300) break;
  }
  return out;
}

export function parsePage(url: string, body: string, maxChars = 15_000): PageText {
  const base = new URL(url);
  const meta = parseMeta(body);
  const rawTitle = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = rawTitle ? oneLine(stripHtml(rawTitle)) : meta["og:title"];
  const description = meta["description"] ?? meta["og:description"] ?? meta["twitter:description"];
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => oneLine(stripHtml(m[1]))).filter((h) => h && h.length < 160);
  const lang = /<html\b[^>]*>/i.exec(body)?.[0];
  const hreflang = [...body.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttrs(m[0])).filter((a) => /alternate/i.test(a.rel ?? "") && a.hreflang).map((a) => a.hreflang);
  const text = stripHtml(body).slice(0, maxChars);
  return {
    url,
    ok: true,
    title: title || undefined,
    description: description || undefined,
    headings: [...new Set(headings)].slice(0, 40),
    text,
    lang: lang ? parseAttrs(lang).lang || undefined : undefined,
    meta,
    jsonLd: parseJsonLd(body),
    hreflang: [...new Set(hreflang)].slice(0, 60),
    links: parseLinks(body, base),
    note: text.length < 200 ? "very little readable text — the page may render with JavaScript" : undefined,
  };
}

export async function readPage(url: string, maxChars = 15_000): Promise<PageText> {
  let u: URL;
  try {
    u = checkUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch (e) {
    return { url, ok: false, headings: [], text: "", note: e instanceof UnsafeUrlError ? e.message : "invalid URL" };
  }
  const blocked = (await disallowedPaths(u.origin)).some((p) => u.pathname.startsWith(p));
  if (blocked) return { url: u.toString(), ok: false, headings: [], text: "", note: "disallowed by robots.txt" };
  try {
    const r = await safeFetch(u, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,text/markdown" }, timeoutMs: 12_000, maxBytes: 600_000 });
    if (!r.ok) return { url: u.toString(), ok: false, headings: [], text: "", note: `HTTP ${r.status}` };
    const type = (r.headers["content-type"] ?? "").toLowerCase();
    if (type && !/html|text|xml|markdown/.test(type)) return { url: r.url, ok: false, headings: [], text: "", note: `not a web page (${type.split(";")[0]})` };
    return parsePage(r.url, r.body, maxChars);
  } catch (e) {
    return { url: u.toString(), ok: false, headings: [], text: "", note: (e as Error).message };
  }
}

/** Same-site pages most likely to state who the business is, where it operates and what it costs. */
const SUPPORTING = [
  { kind: "about", re: /\b(about|about-us|company|who-we-are|our-story)\b/i },
  { kind: "contact", re: /\b(contact|contact-us|locations?|find-us|visit-us|stores?)\b/i },
  { kind: "pricing", re: /\b(pricing|prices|plans|rates|menu)\b/i },
];

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

export function supportingLinks(home: PageText, max = 3): string[] {
  if (!home.ok || !home.links) return [];
  const origin = new URL(home.url);
  const picked: string[] = [];
  for (const { re } of SUPPORTING) {
    const hit = home.links.find((l) => {
      const u = new URL(l.href);
      return sameSite(u, origin) && u.pathname !== origin.pathname && (re.test(u.pathname) || re.test(l.text.toLowerCase().replace(/\s+/g, "-")));
    });
    if (hit && !picked.includes(hit.href)) picked.push(hit.href);
    if (picked.length >= max) break;
  }
  return picked;
}

/** The homepage plus up to three same-site about / contact / pricing pages it links to. */
export async function readSite(url: string): Promise<PageText[]> {
  const home = await readPage(url);
  const extra = await Promise.all(supportingLinks(home).map((u) => readPage(u, 8_000)));
  return [home, ...extra];
}

/** README of a public GitHub repo via the REST API (raw media type). */
export async function readGithubReadme(repoUrl: string): Promise<PageText> {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) return { url: repoUrl, ok: false, headings: [], text: "", note: "not a repo URL (org pages are skipped)" };
  // Owner/repo become API path segments (sent with GITHUB_TOKEN) — allow GitHub's name charset only.
  if (![m[1], m[2]].every((x) => /^[A-Za-z0-9_.-]{1,100}$/.test(x) && !/^\.+$/.test(x))) return { url: repoUrl, ok: false, headings: [], text: "", note: "not a valid GitHub owner/repo" };
  const api = `https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, "")}/readme`;
  try {
    const r = await fetch(api, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github.raw+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { url: repoUrl, ok: false, headings: [], text: "", note: `HTTP ${r.status}` };
    const md = await r.text();
    const headings = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 40);
    return { url: repoUrl, ok: true, title: `${m[1]}/${m[2]}`, headings, text: md.slice(0, 15_000) };
  } catch (e) {
    return { url: repoUrl, ok: false, headings: [], text: "", note: (e as Error).message };
  }
}
