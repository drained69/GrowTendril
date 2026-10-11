import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import type { FetchedPost } from "@/server/integrations/providers/types";
import { termHits } from "@/server/domain/intel/signals";
import { companyFromHeadline } from "@/server/domain/intel/entities";
import { publicUrl } from "@/server/security/public-http";

type Mode = (typeof s.dataMode.enumValues)[number];

/** Store fetched posts (idempotent on provider+externalId). Returns number of new posts. */
export async function ingestPosts(db: DB, projectId: string, provider: string, posts: FetchedPost[], mode: Mode, ctx: { keywords: string[] }): Promise<number> {
  let added = 0;
  for (const p of posts) {
    if (!p.externalId || !p.authorHandle || !(p.publishedAt instanceof Date) || !Number.isFinite(p.publishedAt.getTime())) continue;
    let sourceUrl: string;
    let authorUrl: string | null = null;
    try { sourceUrl = publicUrl(p.url).toString(); } catch { continue; }
    if (p.authorUrl) { try { authorUrl = publicUrl(p.authorUrl).toString(); } catch { /* Ignore unsafe profile links. */ } }
    const [src] = await db
      .insert(s.sources)
      .values({ id: newId(), projectId, provider, url: sourceUrl, title: p.title ?? null, dataMode: mode })
      .onConflictDoUpdate({ target: [s.sources.projectId, s.sources.url], set: { fetchedAt: new Date() } })
      .returning({ id: s.sources.id });
    const topics = termHits(`${p.title ?? ""} ${p.content}`, ctx.keywords);
    // Sources state the organization only sometimes (GitHub org, Show HN); otherwise read it from a headline.
    const company = p.companyHint ?? companyFromHeadline((p.title ?? p.content).replace(/^r\/\w+:\s*/, ""));
    const res = await db
      .insert(s.socialPosts)
      .values({
        id: newId(),
        projectId,
        sourceId: src.id,
        provider,
        externalId: p.externalId,
        url: sourceUrl,
        authorHandle: p.authorHandle,
        authorName: p.authorName ?? null,
        authorUrl,
        authorFollowers: p.authorFollowers ?? null,
        title: p.title ?? null,
        content: p.content,
        publishedAt: p.publishedAt,
        engagement: p.engagement,
        topics,
        entities: { companies: company ? [company] : [], products: [], people: [p.authorHandle] },
        dataMode: mode,
      })
      .onConflictDoNothing({
        target: [s.socialPosts.projectId, s.socialPosts.provider, s.socialPosts.externalId],
      })
      .returning({ id: s.socialPosts.id });
    if (res[0]) added++;
    else await db.update(s.socialPosts).set({ engagement: p.engagement, topics, authorFollowers: p.authorFollowers ?? null })
      .where(and(eq(s.socialPosts.projectId, projectId), eq(s.socialPosts.provider, provider), eq(s.socialPosts.externalId, p.externalId)));
  }
  return added;
}

export async function postsForProject(db: DB, projectId: string) {
  return db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, projectId)));
}
