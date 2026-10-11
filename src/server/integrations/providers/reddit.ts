import { getJson, stripHtml } from "@/server/integrations/providers/http";
import { ProviderError, type Credentials, type FetchedPost, type MarketProvider } from "@/server/integrations/providers/types";

/**
 * Reddit. With API keys it uses the Data API (app-only OAuth). Without them it reads Reddit's
 * public search feed (Atom), which needs no account. Reddit closed self-service API keys in
 * Nov 2025, so keyless is the normal mode.
 */
const tokens = new Map<string, { value: string; exp: number }>();
const ua = (c: Credentials) => c.userAgent || "web:growtendril:0.1 (by /u/growtendril)";
const hasKeys = (c: Credentials) => !!(c.clientId && c.clientSecret);

async function accessToken(c: Credentials): Promise<string> {
  const cached = tokens.get(c.clientId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.value;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua(c),
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ProviderError("reddit", `OAuth failed: HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(c.clientId, { value: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

interface Child {
  data: { id: string; title: string; selftext: string; author: string; created_utc: number; score: number; num_comments: number; permalink: string; subreddit: string };
}

async function searchApi(query: string, since: Date, limit: number, creds: Credentials): Promise<FetchedPost[]> {
  const t = await accessToken(creds);
  const data = await getJson<{ data: { children: Child[] } }>(
    "reddit",
    `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=new&t=month&limit=${Math.min(limit, 100)}&type=link`,
    { headers: { Authorization: `Bearer ${t}`, "User-Agent": ua(creds) } },
  );
  return data.data.children
    .map((c) => c.data)
    .filter((d) => d.created_utc * 1000 >= since.getTime())
    .map(
      (d): FetchedPost => ({
        externalId: d.id,
        url: `https://www.reddit.com${d.permalink}`,
        authorHandle: d.author,
        authorUrl: `https://www.reddit.com/user/${d.author}`,
        title: `r/${d.subreddit}: ${d.title}`,
        content: `${d.title}\n${d.selftext.slice(0, 3000)}`,
        publishedAt: new Date(d.created_utc * 1000),
        engagement: { score: d.score, comments: d.num_comments },
      }),
    );
}

// Keyless access is limited to roughly one request a minute per server, so requests run one
// at a time and wait for Reddit's reset window instead of failing.
const MAX_WAIT_MS = 65_000;
let queue: Promise<unknown> = Promise.resolve();
let nextAt = 0;

function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function noteLimit(res: Response) {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (res.status === 429 || (Number.isFinite(remaining) && remaining < 1)) nextAt = Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000;
}

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

/** Post entries (t3_) from a Reddit Atom feed. Content is escaped HTML, so it is decoded twice. */
export function parseRedditFeed(xml: string): FetchedPost[] {
  const out: FetchedPost[] = [];
  for (const b of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const id = tag(b, "id")?.trim() ?? "";
    const url = b.match(/<link href="([^"]+)"/)?.[1];
    if (!id.startsWith("t3_") || !url) continue;
    const author = stripHtml(tag(b, "name") ?? "").replace(/^\/u\//, "") || "[deleted]";
    const sub = b.match(/<category[^>]*label="r\/([^"]+)"/)?.[1];
    const title = stripHtml(tag(b, "title") ?? "");
    const body = stripHtml(stripHtml(tag(b, "content") ?? "")).replace(/\s*submitted by \/u\/\S+.*$/, "");
    out.push({
      externalId: id.slice(3),
      url,
      authorHandle: author,
      authorUrl: `https://www.reddit.com/user/${author}`,
      title: sub ? `r/${sub}: ${title}` : title,
      content: `${title}\n${body.slice(0, 3000)}`,
      publishedAt: new Date(tag(b, "published") ?? tag(b, "updated") ?? Date.now()),
      engagement: {},
    });
  }
  return out;
}

function searchFeed(query: string, since: Date, limit: number, creds: Credentials): Promise<FetchedPost[]> {
  const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&t=month&type=link&limit=${Math.min(limit, 100)}`;
  return inTurn(async () => {
    // A second attempt covers the window being used up by an earlier process on this server.
    for (let attempt = 0; ; attempt++) {
      const wait = nextAt - Date.now();
      if (wait > MAX_WAIT_MS) throw new ProviderError("reddit", `rate limited (429) — keyless search resumes in ${Math.ceil(wait / 1000)}s`, 429);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const res = await fetch(url, { headers: { "User-Agent": ua(creds), Accept: "application/atom+xml" }, signal: AbortSignal.timeout(15_000) }).catch((e: Error) => {
        throw new ProviderError("reddit", `network error: ${e.message}`);
      });
      noteLimit(res);
      if (res.status === 429 && attempt === 0) continue;
      if (res.status === 429) throw new ProviderError("reddit", "rate limited (429) — backing off until next cycle", 429);
      if (!res.ok) throw new ProviderError("reddit", `public search feed returned HTTP ${res.status}${res.status === 403 ? " (Reddit blocks some server networks; add Reddit API keys to use the Data API)" : ""}`, res.status);
      return parseRedditFeed(await res.text())
        .filter((p) => p.publishedAt >= since)
        .slice(0, limit);
    }
  });
}

export const reddit: MarketProvider = {
  id: "reddit",
  name: "Reddit",
  description: "Posts across subreddits. Works without keys through Reddit's public search feed (about one search a minute); approved Reddit API keys add vote counts and higher limits.",
  category: "community",
  docsUrl: "https://www.reddit.com/dev/api",
  access: "public_api",
  credentialFields: [
    { key: "clientId", label: "Client ID", secret: false, optional: true, placeholder: "From an approved Reddit API app", help: "Optional. Reddit now approves API apps by request; without keys GrowTendril uses the public search feed." },
    { key: "clientSecret", label: "Client secret", secret: true, optional: true },
    { key: "userAgent", label: "User agent", secret: false, optional: true, placeholder: "web:yourapp:1.0 (by /u/you)" },
  ],
  envFallback: { clientId: "REDDIT_CLIENT_ID", clientSecret: "REDDIT_CLIENT_SECRET", userAgent: "REDDIT_USER_AGENT" },
  // Both keys or neither: a half-filled pair is a mistake, not keyless mode.
  isReady: (c) => !!c.clientId === !!c.clientSecret,
  combineQueries: (c) => !hasKeys(c),
  search(query, { since, limit }, creds) {
    return hasKeys(creds) ? searchApi(query, since, limit, creds) : searchFeed(query, since, limit, creds);
  },
};
