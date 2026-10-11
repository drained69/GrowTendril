import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { readyProviders, listConnections } from "@/server/integrations/vault";
import { ProviderError } from "@/server/integrations/providers";
import { ingestPosts } from "@/server/domain/intel/ingest";
import { analyzeProject, type Logger, type AnalysisStats } from "@/server/domain/intel/analyze";
import { daysAgo } from "@/lib/time";
import { enrichCreators, scoutCreators } from "@/server/domain/growth/creator-scout";
import { buildCreatorReport, latestCreatorReport, saveCreatorReport } from "@/server/domain/growth/creator-report";
import { aiEnabled, aiName } from "@/server/integrations/llm";
import type { Audience } from "@/server/domain/intel/market-taxonomy";

const AUDIENCE_NOUN: Record<Audience, string> = { businesses: "business", consumers: "consumer", developers: "developer" };

/**
 * DISCOVERY AGENT — queries every available provider for the product's keywords,
 * stores what it finds (LIVE), then runs the analysis engine. Provider errors and
 * unavailable providers are logged, never papered over.
 */
export async function runDiscovery(db: DB, projectId: string, log: Logger): Promise<{ fetched: Record<string, number>; errors: string[]; stats: AnalysisStats }> {
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  const [project] = await db.select({ name: s.projects.name }).from(s.projects).where(eq(s.projects.id, projectId));
  if (!profile || !project) throw new Error("No product profile");
  const keywords = [...new Set([...profile.keywords, ...profile.terminology.slice(0, 6)])];
  // Market terms first, then the product's own name so public mentions of it are found too.
  const brand = project.name.trim().length >= 3 ? `"${project.name.trim()}"` : null;
  const queries = [...profile.keywords.slice(0, 4).map((q) => (q.includes(" ") ? `"${q}"` : q)), ...(brand ? [brand] : [])];
  const fetched: Record<string, number> = {};
  const errors: string[] = [];
  let successfulSearches = 0;

  for (const c of await listConnections(db, projectId)) {
    if (!c.ready) log("discovery", `${c.provider.name}: skipped — ${c.source === "restricted" ? c.provider.restrictedReason : "not connected"}`);
  }
  for (const { provider, creds, source } of await readyProviders(db, projectId)) {
    if (provider.audiences && !provider.audiences.includes(profile.audience as Audience)) {
      log("discovery", `${provider.name}: skipped — only used for ${provider.audiences.map((a) => AUDIENCE_NOUN[a]).join(" / ")} products (change Customers in your product profile to include it)`);
      continue;
    }
    let n = 0;
    const searches = provider.combineQueries?.(creds) ? [queries.join(" OR ")] : queries;
    const perSearch = Math.min(100, 25 * Math.ceil(queries.length / searches.length));
    for (const q of searches) {
      try {
        const posts = await provider.search(q, { since: daysAgo(14), limit: perSearch }, creds);
        n += await ingestPosts(db, projectId, provider.id, posts, "LIVE", { keywords });
        successfulSearches++;
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(msg);
        log("discovery", msg);
        // Rate limits, bad keys and exhausted credits won't change on the next query.
        if (e instanceof ProviderError && [401, 402, 403, 429].includes(e.status ?? 0)) break;
      }
    }
    fetched[provider.id] = n;
    log("discovery", `${provider.name} (${source === "workspace" ? "workspace key" : source === "platform" ? "platform key" : "keyless"}): ${n} new post(s)`);
  }
  if (!successfulSearches) {
    throw new Error(errors.length
      ? "The market sources could not be read. Check their connection status and try again; this scan will be refunded."
      : "No sources are ready for this product. Add search terms and connect a source before running a scan; this scan will be refunded.");
  }
  // Creators known for the topic, not only those who happened to post this week.
  const scout = await scoutCreators(db, projectId, log).catch((e: Error) => (log("kol", `Creator scouting skipped: ${e.message}`), null));
  const stats = await analyzeProject(db, projectId, log);
  await enrichCreators(db, projectId, log, { cache: scout?.cache }).catch((e: Error) => log("kol", `Creator profiles skipped: ${e.message}`));
  await refreshCreatorReport(db, projectId, log);
  return { fetched, errors, stats };
}

/** Rebuild the influencer report after each scan; Claude rewrites the prose at most once a day. */
export async function refreshCreatorReport(db: DB, projectId: string, log: Logger, opts: { forceAi?: boolean } = {}) {
  try {
    const prev = await latestCreatorReport(db, projectId);
    const aiDue = aiEnabled() && (opts.forceAi || !prev || prev.generatedBy !== "claude" || Date.now() - new Date(prev.generatedAt).getTime() > 86_400_000);
    const report = await buildCreatorReport(db, projectId, { ai: aiDue, onAiError: (m) => log("kol", `${aiName()} didn't write the report text, so it keeps the standard wording: ${m}`) });
    if (!report.entries.length) return null;
    // Keep yesterday's AI prose when today's rebuild is template-only and nothing new was written.
    if (!aiDue && prev?.generatedBy === "claude") {
      for (const e of report.entries) {
        const old = prev.entries.find((x) => x.kolId === e.kolId);
        if (old) Object.assign(e, { analysis: old.analysis, approach: old.approach, outreachDraft: old.outreachDraft });
      }
      report.generatedBy = "claude";
    }
    await saveCreatorReport(db, projectId, report);
    log("kol", `Influencer report updated: ${report.totals.creators} creators, ${report.totals.contactFirst} to contact first`);
    return report;
  } catch (e) {
    log("kol", `Influencer report not updated: ${(e as Error).message}`);
    return null;
  }
}
