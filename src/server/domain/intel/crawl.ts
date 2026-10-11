import { stripHtml, USER_AGENT } from "@/server/integrations/providers/http";
import { getPublicText, publicUrl } from "@/server/security/public-http";

/**
 * Polite public-page reader for product onboarding. Honors robots.txt (User-agent: *),
 * one request per page, short timeouts, text only.
 */

const robotsCache = new Map<string, { rules: string[]; expiresAt: number }>();

async function disallowedPaths(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;
  let rules: string[] = [];
  try {
    const r = await getPublicText(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, timeoutMs: 6000, maxBytes: 100_000 });
    if (r.ok) {
      let applies = false;
      let hasDirectives = false;
      for (const raw of r.text.split("\n")) {
        const line = raw.split("#")[0].trim();
        const [k, ...rest] = line.split(":");
        const v = rest.join(":").trim();
        if (/^user-agent$/i.test(k)) {
          const match = v === "*" || /growtendril|forage|morrowloop|growthos/i.test(v);
          applies = hasDirectives ? match : applies || match;
          hasDirectives = false;
        } else if (/^(disallow|allow)$/i.test(k)) {
          hasDirectives = true;
          if (applies && v) rules.push(`${k.toLowerCase()}:${v}`);
        }
      }
    }
  } catch {
    rules = [];
  }
  if (robotsCache.size >= 500) robotsCache.delete(robotsCache.keys().next().value!);
  robotsCache.set(origin, { rules, expiresAt: Date.now() + 3_600_000 });
  return rules;
}

export interface PageText {
  url: string;
  ok: boolean;
  title?: string;
  description?: string;
  headings: string[];
  text: string;
  note?: string;
  /** Absolute http(s) links found on the page (deduped). */
  links?: string[];
  /** og:site_name, when the page declares one. */
  siteName?: string;
  /** Parsed schema.org JSON-LD blocks. */
  jsonLd?: unknown[];
}

const meta = (body: string, attr: "name" | "property", key: string) =>
  body.match(new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
  body.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`, "i"))?.[1];

function pageLinks(body: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
    if (out.size >= 300) break;
  }
  return [...out];
}

function jsonLdBlocks(body: string): unknown[] {
  const out: unknown[] = [];
  for (const m of body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      out.push(...(Array.isArray(v) ? v : (v as { "@graph"?: unknown[] })["@graph"] ?? [v]));
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return out.slice(0, 20);
}

export async function readPage(url: string, maxChars = 15_000): Promise<PageText> {
  let u: URL;
  try {
    u = publicUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch (error) {
    return { url, ok: false, headings: [], text: "", note: (error as Error).message };
  }
  try {
    const r = await getPublicText(u, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,text/markdown" },
      beforeRequest: async (target) => {
        const rules = await disallowedPaths(target.origin);
        let best = -1;
        let blocked = false;
        for (const rule of rules) {
          const colon = rule.indexOf(":");
          const path = rule.slice(colon + 1);
          const pattern = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
          if (new RegExp(`^${pattern}`).test(`${target.pathname}${target.search}`) && path.length >= best) {
            // Allow wins when both matching rules are equally specific.
            const allow = rule.startsWith("allow:");
            if (path.length > best || allow) blocked = !allow;
            best = path.length;
          }
        }
        if (blocked) throw new Error("disallowed by robots.txt");
      },
    });
    if (!r.ok) return { url: u.toString(), ok: false, headings: [], text: "", note: `HTTP ${r.status}` };
    if (r.contentType && !/^(text\/(html|plain|markdown)|application\/xhtml\+xml)\b/i.test(r.contentType)) {
      return { url: r.url, ok: false, headings: [], text: "", note: "The website did not return a readable text page" };
    }
    const body = r.text;
    const final = new URL(r.url || u.toString());
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const description = meta(body, "name", "description") ?? meta(body, "property", "og:description");
    const siteName = meta(body, "property", "og:site_name");
    const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripHtml(m[1])).filter((h) => h && h.length < 160).slice(0, 40);
    return {
      url: final.toString(),
      ok: true,
      title: title ? stripHtml(title) : undefined,
      description: description ? stripHtml(description) : undefined,
      siteName: siteName ? stripHtml(siteName) : undefined,
      headings,
      text: stripHtml(body).slice(0, maxChars),
      links: pageLinks(body, final),
      jsonLd: jsonLdBlocks(body),
    };
  } catch (e) {
    return { url: u.toString(), ok: false, headings: [], text: "", note: (e as Error).message };
  }
}

/** README of a public GitHub repo via the REST API (raw media type). */
export async function readGithubReadme(repoUrl: string): Promise<PageText> {
  let parsed: URL;
  try { parsed = publicUrl(repoUrl); } catch { return { url: repoUrl, ok: false, headings: [], text: "", note: "not a public GitHub repo URL" }; }
  const m = parsed.hostname === "github.com" ? parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/) : null;
  if (!m) return { url: repoUrl, ok: false, headings: [], text: "", note: "not a repo URL (org pages are skipped)" };
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
