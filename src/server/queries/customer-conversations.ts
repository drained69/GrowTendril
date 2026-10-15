import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";

/** Individual buying signals keep their source context, scoped on both sides of the join. */
export function customerConversations(db: DB, projectId: string) {
  return db.select({
    opportunity: s.opportunities,
    post: { url: s.socialPosts.url, provider: s.socialPosts.provider, content: s.socialPosts.content, author: s.socialPosts.authorHandle, publishedAt: s.socialPosts.publishedAt },
  })
    .from(s.opportunities)
    .leftJoin(s.socialPosts, and(eq(s.socialPosts.projectId, projectId), eq(s.opportunities.subjectKey, sql`'post:' || ${s.socialPosts.id}`)))
    .where(and(eq(s.opportunities.projectId, projectId), eq(s.opportunities.type, "PERSON"), inArray(s.opportunities.status, ["open", "researching", "experiment"])))
    .orderBy(desc(s.opportunities.overallScore), desc(s.opportunities.updatedAt))
    .limit(100);
}
