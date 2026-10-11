import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { readyProviders, resolveCredentials } from "@/server/integrations/vault";
import { ProviderError, providerById, type CreatorProfile } from "@/server/integrations/providers";
import { ingestPosts } from "@/server/domain/intel/ingest";
import type { Logger } from "@/server/domain/intel/analyze";
import type { Audience } from "@/server/domain/intel/market-taxonomy";
import { daysAgo } from "@/lib/time";

/**
 * Creator scouting: besides people who happened to post this week, look for creators whose
 * profile says they cover the space, then read what they actually publish. Their posts feed
 * the normal creator scoring, so a profile claim alone never ranks anyone.
 */

export type ProfileCache = Map<string, CreatorProfile>;
const key = (provider: string, handle: string) => `${provider}:${handle.toLowerCase()}`;

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function scoutCreators(db: DB, projectId: string, log: Logger, opts: { queries?: number; perQuery?: number; maxCandidates?: number } = {}): Promise<{ candidates: number; posts: number; cache: ProfileCache }> {
  const cache: ProfileCache = new Map();
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  const [project] = await db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId));
  if (!profile || !project) return { candidates: 0, posts: 0, cache };
  const keywords = [...new Set([...profile.keywords, ...profile.terminology.slice(0, 6)])];
  let candidates = 0;
  let ingested = 0;
  for (const { provider, creds } of await readyProviders(db, projectId)) {
    if (!provider.findCreators || !provider.recentPosts) continue;
    if (provider.audiences && !provider.audiences.includes(profile.audience as Audience)) continue;
    // Authors already read in the last 3 days don't need their feed fetched again.
    const recent = await db
      .selectDistinct({ h: s.socialPosts.authorHandle })
      .from(s.socialPosts)
      .where(and(eq(s.socialPosts.projectId, projectId), eq(s.socialPosts.provider, provider.id), gte(s.socialPosts.createdAt, daysAgo(3))));
    const seen = new Set(recent.map((r) => r.h.toLowerCase()));
    const found = new Map<string, CreatorProfile>();
    for (const q of profile.keywords.slice(0, opts.queries ?? 3)) {
      try {
        for (const c of await provider.findCreators(q, { limit: opts.perQuery ?? 15 }, creds)) {
          if (!seen.has(c.handle.toLowerCase()) && !found.has(c.handle.toLowerCase())) found.set(c.handle.toLowerCase(), c);
        }
      } catch (e) {
        log("kol", `${provider.name} creator search for "${q}" failed: ${(e as Error).message}`);
        if (e instanceof ProviderError && [401, 402, 403, 429].includes(e.status ?? 0)) break;
      }
    }
    const pick = [...found.values()].slice(0, opts.maxCandidates ?? 12);
    if (!pick.length) continue;
    candidates += pick.length;
    const results = await inBatches(pick, 4, async (c) => {
      try {
        const full = (await provider.profile?.(c.handle, creds, c.url)) ?? c;
        cache.set(key(provider.id, c.handle), full);
        const posts = await provider.recentPosts!(c.handle, { since: daysAgo(30), limit: 30 }, creds);
        return ingestPosts(
          db,
          projectId,
          provider.id,
          posts.map((p) => ({ ...p, authorName: p.authorName ?? full.displayName, authorFollowers: p.authorFollowers ?? full.followers })),
          "LIVE",
          { keywords },
        );
      } catch (e) {
        log("kol", `${provider.name}: couldn't read @${c.handle} (${(e as Error).message})`);
        return 0;
      }
    });
    const n = results.reduce((a, b) => a + b, 0);
    ingested += n;
    log("kol", `${provider.name}: scouted ${pick.length} creator profile(s) matching your topics, read ${n} of their recent posts`);
  }
  return { candidates, posts: ingested, cache };
}

/** Fetch the public profile of the top-ranked creators (bio, links, public email). */
export async function enrichCreators(db: DB, projectId: string, log: Logger, opts: { top?: number; cache?: ProfileCache } = {}): Promise<number> {
  const rows = await db
    .select()
    .from(s.kols)
    .where(and(eq(s.kols.projectId, projectId), inArray(s.kols.status, ["candidate", "shortlisted", "engaged"])))
    .orderBy(desc(s.kols.overallScore))
    .limit(opts.top ?? 15);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const stale = rows.filter((k) => !k.profile.fetchedAt || new Date(k.profile.fetchedAt).getTime() < weekAgo);
  let updated = 0;
  await inBatches(stale, 4, async (k) => {
    const provider = providerById(k.provider);
    if (!provider?.profile) return;
    try {
      const { creds } = await resolveCredentials(db, projectId, provider);
      if (!provider.isReady(creds)) return;
      const p = opts.cache?.get(key(k.provider, k.handle)) ?? (await provider.profile(k.handle, creds, k.url));
      if (!p) return;
      await db
        .update(s.kols)
        .set({
          profile: { bio: p.bio, links: p.links, publicEmail: p.publicEmail, location: p.location, avatarUrl: p.avatarUrl, fetchedAt: new Date().toISOString() },
          displayName: k.displayName ?? p.displayName ?? null,
          url: k.url ?? p.url,
          followers: Math.max(k.followers ?? 0, p.followers ?? 0) || null,
          updatedAt: new Date(),
        })
        .where(eq(s.kols.id, k.id));
      updated++;
    } catch (e) {
      log("kol", `Profile for @${k.handle} unavailable: ${(e as Error).message}`);
    }
  });
  if (updated) log("kol", `Read the public profiles of ${updated} top creator(s) for contact details`);
  return updated;
}
