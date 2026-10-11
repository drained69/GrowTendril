import { getJson } from "@/server/integrations/providers/http";
import type { CreatorProfile, FetchedPost, MarketProvider } from "@/server/integrations/providers/types";
import { emailsIn, linksIn } from "@/server/domain/growth/creator-contacts";

/** Bluesky via the public AppView (AT Protocol). Public posts, no key required. */
const APPVIEW = "https://api.bsky.app/xrpc";

export interface BskyPost {
  uri: string;
  author: { did: string; handle: string; displayName?: string };
  record: { text?: string; createdAt?: string };
  indexedAt: string;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  quoteCount?: number;
}

/** at://did/app.bsky.feed.post/<rkey> → https://bsky.app/profile/<handle>/post/<rkey> */
export function bskyPostUrl(p: Pick<BskyPost, "uri" | "author">): string {
  const rkey = p.uri.split("/").pop();
  return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
}

export function mapBskyPost(p: BskyPost, followers?: number): FetchedPost {
  return {
    externalId: p.uri,
    url: bskyPostUrl(p),
    authorHandle: p.author.handle,
    authorName: p.author.displayName || undefined,
    authorUrl: `https://bsky.app/profile/${p.author.handle}`,
    authorFollowers: followers,
    content: (p.record.text ?? "").slice(0, 4000),
    publishedAt: new Date(p.record.createdAt ?? p.indexedAt),
    engagement: { likes: p.likeCount ?? 0, comments: p.replyCount ?? 0, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) },
  };
}

interface BskyActor {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount?: number;
}

export function mapBskyActor(a: BskyActor): CreatorProfile {
  const bio = a.description ?? "";
  return { handle: a.handle, displayName: a.displayName || undefined, bio: bio || undefined, followers: a.followersCount, links: linksIn(bio), publicEmail: emailsIn(bio)[0], avatarUrl: a.avatar, url: `https://bsky.app/profile/${a.handle}` };
}

export const bluesky: MarketProvider = {
  id: "bluesky",
  name: "Bluesky",
  description: "Public posts and author follower counts via Bluesky's open AppView API. No key required.",
  category: "social",
  docsUrl: "https://docs.bsky.app/docs/api/app-bsky-feed-search-posts",
  access: "public_api",
  credentialFields: [],
  envFallback: {},
  isReady: () => true,
  async search(query, { since, limit }) {
    const params = new URLSearchParams({ q: query, sort: "latest", limit: String(Math.min(limit, 100)), since: since.toISOString() });
    const data = await getJson<{ posts: BskyPost[] }>("bluesky", `${APPVIEW}/app.bsky.feed.searchPosts?${params}`);
    const posts = data.posts.filter((p) => p.record.text);
    // Follower counts help creator scoring; one batched lookup per search (max 25 actors).
    const actors = [...new Set(posts.map((p) => p.author.did))].slice(0, 25);
    const followers = new Map<string, number>();
    if (actors.length) {
      const q = new URLSearchParams();
      for (const a of actors) q.append("actors", a);
      const profiles = await getJson<{ profiles: { did: string; followersCount?: number }[] }>("bluesky", `${APPVIEW}/app.bsky.actor.getProfiles?${q}`).catch(() => ({ profiles: [] }));
      for (const pr of profiles.profiles) if (pr.followersCount != null) followers.set(pr.did, pr.followersCount);
    }
    return posts.map((p) => mapBskyPost(p, followers.get(p.author.did)));
  },
  async findCreators(query, { limit }) {
    const params = new URLSearchParams({ q: query.replace(/"/g, ""), limit: String(Math.min(limit, 100)) });
    const data = await getJson<{ actors: BskyActor[] }>("bluesky", `${APPVIEW}/app.bsky.actor.searchActors?${params}`);
    return data.actors.map(mapBskyActor);
  },
  async recentPosts(handle, { since, limit }) {
    const params = new URLSearchParams({ actor: handle, limit: String(Math.min(limit, 100)), filter: "posts_no_replies" });
    const data = await getJson<{ feed: { post: BskyPost; reason?: unknown }[] }>("bluesky", `${APPVIEW}/app.bsky.feed.getAuthorFeed?${params}`);
    // Reposts are someone else's words; judge creators only on what they wrote.
    return data.feed.filter((f) => !f.reason && f.post.author.handle === handle && f.post.record.text).map((f) => mapBskyPost(f.post)).filter((p) => p.publishedAt >= since);
  },
  async profile(handle) {
    const p = await getJson<BskyActor>("bluesky", `${APPVIEW}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`).catch(() => null);
    return p ? mapBskyActor(p) : null;
  },
};
