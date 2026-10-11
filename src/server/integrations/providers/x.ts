import { getJson } from "@/server/integrations/providers/http";
import type { CreatorProfile, FetchedPost, MarketProvider } from "@/server/integrations/providers/types";
import { emailsIn, linksIn } from "@/server/domain/growth/creator-contacts";

/** X API v2 recent search (bearer token; requires an X API plan that includes search). */
interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: { like_count: number; reply_count: number; retweet_count: number; quote_count: number; impression_count?: number };
}
interface User {
  id: string;
  username: string;
  name: string;
  public_metrics?: { followers_count: number };
}

export const x: MarketProvider = {
  id: "x",
  name: "X",
  description: "Recent posts with engagement and author follower counts via X API v2 recent search.",
  category: "social",
  docsUrl: "https://developer.x.com/en/docs/x-api/tweets/search/introduction",
  access: "official_api",
  credentialFields: [{ key: "bearerToken", label: "Bearer token", secret: true, help: "Requires an X API plan that includes recent search." }],
  envFallback: { bearerToken: "X_BEARER_TOKEN" },
  isReady: (c) => !!c.bearerToken,
  async search(query, { since, limit }, creds) {
    const params = new URLSearchParams({
      query: `${query} -is:retweet lang:en`,
      max_results: String(Math.max(10, Math.min(limit, 100))),
      start_time: new Date(Math.max(since.getTime(), Date.now() - 6.9 * 86_400_000)).toISOString(),
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name,public_metrics",
    });
    const data = await getJson<{ data?: Tweet[]; includes?: { users?: User[] } }>("x", `https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${creds.bearerToken}` },
    });
    const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
    return (data.data ?? []).map((t): FetchedPost => {
      const u = users.get(t.author_id);
      const handle = u?.username ?? t.author_id;
      return {
        externalId: t.id,
        url: `https://x.com/${handle}/status/${t.id}`,
        authorHandle: handle,
        authorName: u?.name,
        authorUrl: `https://x.com/${handle}`,
        authorFollowers: u?.public_metrics?.followers_count,
        content: t.text,
        publishedAt: new Date(t.created_at),
        engagement: { likes: t.public_metrics.like_count, comments: t.public_metrics.reply_count, shares: t.public_metrics.retweet_count + t.public_metrics.quote_count, views: t.public_metrics.impression_count },
      };
    });
  },
  async profile(handle, creds): Promise<CreatorProfile | null> {
    const params = new URLSearchParams({ "user.fields": "description,url,location,public_metrics,profile_image_url,entities" });
    const r = await getJson<{ data?: { username: string; name: string; description?: string; location?: string; profile_image_url?: string; public_metrics?: { followers_count: number }; entities?: { url?: { urls?: { expanded_url?: string }[] }; description?: { urls?: { expanded_url?: string }[] } } } }>(
      "x",
      `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?${params}`,
      { headers: { Authorization: `Bearer ${creds.bearerToken}` } },
    ).catch(() => null);
    const u = r?.data;
    if (!u) return null;
    const expanded = [...(u.entities?.url?.urls ?? []), ...(u.entities?.description?.urls ?? [])].map((x) => x.expanded_url).filter((x): x is string => !!x);
    return { handle: u.username, displayName: u.name, bio: u.description, followers: u.public_metrics?.followers_count, links: [...new Set([...expanded, ...linksIn(u.description ?? "")])], publicEmail: emailsIn(u.description ?? "")[0], location: u.location, avatarUrl: u.profile_image_url, url: `https://x.com/${u.username}` };
  },
};
