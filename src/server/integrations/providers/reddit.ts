import { getJson } from "@/server/integrations/providers/http";
import { ProviderError, type Credentials, type FetchedPost, type MarketProvider } from "@/server/integrations/providers/types";
import { sha256 } from "@/server/lib/ids";

/** Reddit Data API with app-only OAuth (client credentials), per Reddit's API terms. */
const tokens = new Map<string, { value: string; exp: number }>();
// Keyed by id+secret: a workspace that knows another app's client ID must not reuse its cached token.
const cacheKey = (c: Credentials) => sha256(`${c.clientId}\u0000${c.clientSecret}`);
const ua = (c: Credentials) => c.userAgent || "web:growthos:0.1 (by /u/growthos)";

async function accessToken(c: Credentials): Promise<string> {
  const cached = tokens.get(cacheKey(c));
  if (cached && cached.exp > Date.now() + 60_000) return cached.value;
  const id = c.clientId;
  const secret = c.clientSecret;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua(c),
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ProviderError("reddit", `OAuth failed: HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(cacheKey(c), { value: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

interface Child {
  data: { id: string; title: string; selftext: string; author: string; created_utc: number; score: number; num_comments: number; permalink: string; subreddit: string };
}

export const reddit: MarketProvider = {
  id: "reddit",
  name: "Reddit",
  description: "Posts across subreddits via the Reddit Data API with app-only OAuth, as Reddit's API terms require.",
  category: "community",
  docsUrl: "https://www.reddit.com/dev/api",
  access: "official_api",
  credentialFields: [
    { key: "clientId", label: "Client ID", secret: false, placeholder: "From reddit.com/prefs/apps (script app)" },
    { key: "clientSecret", label: "Client secret", secret: true },
    { key: "userAgent", label: "User agent", secret: false, optional: true, placeholder: "web:yourapp:1.0 (by /u/you)" },
  ],
  envFallback: { clientId: "REDDIT_CLIENT_ID", clientSecret: "REDDIT_CLIENT_SECRET", userAgent: "REDDIT_USER_AGENT" },
  isReady: (c) => !!(c.clientId && c.clientSecret),
  async search(query, { since, limit }, creds) {
    const t = await accessToken(creds);
    const data = await getJson<{ data: { children: Child[] } }>(
      "reddit",
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&sort=new&t=month&limit=${Math.min(limit, 50)}&type=link`,
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
  },
};
