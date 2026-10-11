import { getJson } from "@/server/integrations/providers/http";
import type { CreatorProfile, FetchedPost, MarketProvider } from "@/server/integrations/providers/types";
import { emailsIn, linksIn } from "@/server/domain/growth/creator-contacts";

/** YouTube Data API v3 (API key). Video stats + channel subscriber counts. */
interface SearchItem {
  id: { videoId: string };
  snippet: { title: string; description: string; channelId: string; channelTitle: string; publishedAt: string };
}

export const youtube: MarketProvider = {
  id: "youtube",
  name: "YouTube",
  description: "Videos, view/like/comment counts and channel subscribers via the YouTube Data API v3.",
  category: "video",
  docsUrl: "https://developers.google.com/youtube/v3",
  access: "official_api",
  credentialFields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "AIza…", help: "Google Cloud API key with YouTube Data API v3 enabled." }],
  envFallback: { apiKey: "YOUTUBE_API_KEY" },
  isReady: (c) => !!c.apiKey,
  async search(query, { since, limit }, creds) {
    const key = creds.apiKey;
    const s = await getJson<{ items: SearchItem[] }>(
      "youtube",
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&q=${encodeURIComponent(query)}&publishedAfter=${since.toISOString()}&maxResults=${Math.min(limit, 25)}&key=${key}`,
    );
    if (!s.items.length) return [];
    const ids = s.items.map((i) => i.id.videoId).join(",");
    const channelIds = [...new Set(s.items.map((i) => i.snippet.channelId))].join(",");
    const [v, c] = await Promise.all([
      getJson<{ items: { id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>("youtube", `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${key}`),
      getJson<{ items: { id: string; statistics: { subscriberCount?: string } }[] }>("youtube", `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${key}`),
    ]);
    const stats = new Map(v.items.map((i) => [i.id, i.statistics]));
    const subs = new Map(c.items.map((i) => [i.id, Number(i.statistics.subscriberCount ?? 0)]));
    return s.items.map((i): FetchedPost => {
      const st = stats.get(i.id.videoId) ?? {};
      return {
        externalId: i.id.videoId,
        url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
        authorHandle: i.snippet.channelTitle,
        authorUrl: `https://www.youtube.com/channel/${i.snippet.channelId}`,
        authorFollowers: subs.get(i.snippet.channelId),
        title: i.snippet.title,
        content: `${i.snippet.title}\n${i.snippet.description}`,
        publishedAt: new Date(i.snippet.publishedAt),
        engagement: { views: Number(st.viewCount ?? 0), likes: Number(st.likeCount ?? 0), comments: Number(st.commentCount ?? 0) },
      };
    });
  },
  async profile(handle, creds, url): Promise<CreatorProfile | null> {
    const channelId = url?.match(/\/channel\/([A-Za-z0-9_-]+)/)?.[1];
    if (!channelId) return null;
    const r = await getJson<{ items: { snippet: { title: string; description: string; customUrl?: string; country?: string; thumbnails?: { default?: { url: string } } }; statistics: { subscriberCount?: string } }[] }>(
      "youtube",
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${creds.apiKey}`,
    ).catch(() => null);
    const c = r?.items[0];
    if (!c) return null;
    return { handle, displayName: c.snippet.title, bio: c.snippet.description, followers: Number(c.statistics.subscriberCount ?? 0) || undefined, links: linksIn(c.snippet.description), publicEmail: emailsIn(c.snippet.description)[0], location: c.snippet.country, avatarUrl: c.snippet.thumbnails?.default?.url, url: c.snippet.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${channelId}` };
  },
};
