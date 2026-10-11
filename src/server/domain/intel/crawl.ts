import { stripHtml, USER_AGENT } from "@/server/integrations/providers/http";
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
        if (/^user-agent$/i.test(k)) applies = v === "*" || /growthos/i.test(v);
        else if (applies && /^disallow$/i.test(k) && v) rules.push(v);
      }
    }
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
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
    const body = r.body;
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const description = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripHtml(m[1])).filter((h) => h && h.length < 160).slice(0, 40);
    return { url: u.toString(), ok: true, title: title ? stripHtml(title) : undefined, description: description ? stripHtml(description) : undefined, headings, text: stripHtml(body).slice(0, maxChars) };
  } catch (e) {
    return { url: u.toString(), ok: false, headings: [], text: "", note: (e as Error).message };
  }
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
