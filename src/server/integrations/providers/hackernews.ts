import { getJson, stripHtml } from "@/server/integrations/providers/http";
import type { CreatorProfile, FetchedPost, MarketProvider } from "@/server/integrations/providers/types";
import { emailsIn, linksIn } from "@/server/domain/growth/creator-contacts";

/** Hacker News via the public Algolia HN Search API (no key, documented public API). */
interface HNHit {
  objectID: string;
  title: string | null;
  story_title: string | null;
  story_text: string | null;
  comment_text: string | null;
  author: string;
  created_at: string;
  points: number | null;
  num_comments: number | null;
}

export const hackernews: MarketProvider = {
  id: "hackernews",
  name: "Hacker News",
  description: "Stories and comments via the public Algolia HN Search API.",
  category: "community",
  docsUrl: "https://hn.algolia.com/api",
  access: "public_api",
  // A tech audience: useful for software and developer products, noise for a bakery or a shop.
  audiences: ["developers", "businesses"],
  credentialFields: [],
  envFallback: {},
  isReady: () => true,
  async search(query, { since, limit }) {
    const ts = Math.floor(since.getTime() / 1000);
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=(story,comment)&numericFilters=created_at_i>${ts}&hitsPerPage=${Math.min(limit, 50)}`;
    const data = await getJson<{ hits: HNHit[] }>("hackernews", url);
    return data.hits.map(
      (h): FetchedPost => ({
        externalId: h.objectID,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        authorHandle: h.author,
        authorUrl: `https://news.ycombinator.com/user?id=${h.author}`,
        title: h.title ?? h.story_title ?? undefined,
        // "Show HN: Acme – ..." is a self-declared launch by the named product.
        companyHint: h.title?.match(/^(?:Show|Launch) HN:\s*([A-Z][\w.-]{1,30})\b/)?.[1],
        content: stripHtml([h.title, h.story_text, h.comment_text].filter(Boolean).join(" — ")).slice(0, 4000),
        publishedAt: new Date(h.created_at),
        engagement: { score: h.points ?? 0, comments: h.num_comments ?? 0 },
      }),
    );
  },
  async profile(handle): Promise<CreatorProfile | null> {
    // Official Hacker News API (Firebase): public "about" text and karma.
    const u = await getJson<{ id: string; about?: string; karma?: number } | null>("hackernews", `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(handle)}.json`).catch(() => null);
    if (!u) return null;
    const about = stripHtml((u.about ?? "").replace(/<a [^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, " $1 ").replace(/&#x2F;/g, "/"));
    return { handle: u.id, bio: about || undefined, links: linksIn(about), publicEmail: emailsIn(about)[0], url: `https://news.ycombinator.com/user?id=${u.id}` };
  },
};
