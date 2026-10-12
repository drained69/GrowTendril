import { termHits } from "@/server/domain/intel/signals";
import { DAY_MS } from "@/lib/time";
import type { ScoreComponent } from "@/server/domain/scoring/intent";

/**
 * KOL scoring. Follower count is deliberately NOT a component — it only enters, log-damped,
 * as a minor input to topic authority. A 5k-follower engineer who explains x402 well beats
 * a 500k-follower generalist.
 */

export interface KolPostInput {
  content: string;
  publishedAt: Date;
  provider: string;
  engagement: { likes?: number; comments?: number; shares?: number; views?: number; score?: number; stars?: number };
}

export interface KolScore {
  audienceFit: ScoreComponent;
  topicAuthority: ScoreComponent;
  recentRelevance: ScoreComponent;
  engagementQuality: ScoreComponent;
  narrativeFit: ScoreComponent;
  historicalProductFit: ScoreComponent;
  authenticity: ScoreComponent;
  campaignFit: ScoreComponent;
  overall: number;
  relevantPosts: number;
}

export const KOL_WEIGHTS = {
  audienceFit: 0.2,
  topicAuthority: 0.15,
  recentRelevance: 0.15,
  engagementQuality: 0.1,
  narrativeFit: 0.15,
  historicalProductFit: 0.1,
  authenticity: 0.15,
} as const;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const DEV_PROVIDERS = new Set(["github", "hackernews", "youtube"]);

export function engagementTotal(e: KolPostInput["engagement"]): number {
  return (e.likes ?? 0) + (e.comments ?? 0) * 3 + (e.shares ?? 0) * 2 + (e.score ?? 0) + (e.stars ?? 0);
}

export function scoreKol(
  posts: KolPostInput[],
  ctx: {
    keywords: string[];
    icpTerms: string[];
    productName: string;
    competitors: string[];
    narrativeTerms: string[];
    followers?: number | null;
    handle?: string | null;
    displayName?: string | null;
    bio?: string | null;
    devAudience?: boolean;
    /** Audience composition purchased via x402 (0-1 share matching ICP), when available. */
    verifiedAudienceShare?: number | null;
    now?: number;
  },
): KolScore {
  const now = ctx.now ?? Date.now();
  const relevant = posts.filter((p) => termHits(p.content, ctx.keywords).length > 0);
  const share = posts.length ? relevant.length / posts.length : 0;

  // AUDIENCE FIT — proxy unless verified data was purchased.
  const icpShare = relevant.length ? relevant.filter((p) => termHits(p.content, ctx.icpTerms).length).length / relevant.length : 0;
  const providerBoost = ctx.devAudience && posts.some((p) => DEV_PROVIDERS.has(p.provider)) ? 15 : 0;
  const verified = ctx.verifiedAudienceShare != null;
  const audienceFit: ScoreComponent = {
    score: clamp(verified ? ctx.verifiedAudienceShare! * 100 : share * 55 + icpShare * 30 + providerBoost),
    weight: KOL_WEIGHTS.audienceFit,
    reasons: verified
      ? [`Verified audience data: ${Math.round(ctx.verifiedAudienceShare! * 100)}% matches ICP`]
      : [`Proxy: ${Math.round(share * 100)}% of observed content is on-topic`, `${Math.round(icpShare * 100)}% of on-topic posts address our ICP`, ...(providerBoost ? ["Publishes on developer-native channels"] : [])],
  };

  // TOPIC AUTHORITY — depth (count) and reception (engagement) of on-topic work.
  const relEng = relevant.reduce((s, p) => s + engagementTotal(p.engagement), 0);
  const followerTerm = ctx.followers ? Math.min(10, Math.log10(ctx.followers + 1) * 2) : 0;
  const topicAuthority: ScoreComponent = {
    score: clamp(Math.min(relevant.length, 6) * 9 + Math.min(36, Math.log10(relEng + 1) * 12) + followerTerm),
    weight: KOL_WEIGHTS.topicAuthority,
    reasons: [`${relevant.length} on-topic post(s)`, `${relEng.toLocaleString()} weighted engagement on them`, ctx.followers ? `Followers (log-damped, max +10): ${ctx.followers.toLocaleString()}` : "Follower count unknown — not needed"],
  };

  // RECENT RELEVANCE — on-topic posts in the last 7 / 30 days.
  const last7 = relevant.filter((p) => now - p.publishedAt.getTime() <= 7 * DAY_MS).length;
  const last30 = relevant.filter((p) => now - p.publishedAt.getTime() <= 30 * DAY_MS).length;
  const recentRelevance: ScoreComponent = {
    score: clamp(Math.min(last7, 3) * 26 + Math.min(last30 - last7, 4) * 5),
    weight: KOL_WEIGHTS.recentRelevance,
    reasons: [`${last7} on-topic post(s) this week`, `${last30} in the last 30 days`],
  };

  // ENGAGEMENT QUALITY — discussion (comments) per post, not raw likes.
  const comments = relevant.reduce((s, p) => s + (p.engagement.comments ?? 0), 0);
  const likes = relevant.reduce((s, p) => s + (p.engagement.likes ?? 0) + (p.engagement.score ?? 0), 0);
  const perPost = relevant.length ? relEng / relevant.length : 0;
  const discussionRatio = likes ? comments / likes : comments > 0 ? 1 : 0;
  const engagementQuality: ScoreComponent = {
    score: clamp(Math.min(55, Math.log10(perPost + 1) * 22) + Math.min(45, discussionRatio * 150)),
    weight: KOL_WEIGHTS.engagementQuality,
    reasons: [`${Math.round(perPost)} weighted engagement per on-topic post`, `Discussion ratio ${(discussionRatio * 100).toFixed(0)}% (comments ÷ likes)`],
  };

  // NARRATIVE FIT — overlap with the narratives that matter to us.
  const narrHits = termHits(relevant.map((p) => p.content).join("\n"), ctx.narrativeTerms);
  const narrativeFit: ScoreComponent = {
    score: clamp(Math.min(narrHits.length, 4) * 25),
    weight: KOL_WEIGHTS.narrativeFit,
    reasons: narrHits.length ? [`Active in: ${narrHits.slice(0, 4).join(", ")}`] : ["Not active in our tracked narratives"],
  };

  // HISTORICAL PRODUCT FIT — have they covered us or competitors?
  const allText = posts.map((p) => p.content).join("\n");
  const mentionsUs = termHits(allText, [ctx.productName]).length > 0;
  const compHits = termHits(allText, ctx.competitors);
  const historicalProductFit: ScoreComponent = {
    score: clamp((mentionsUs ? 45 : 0) + Math.min(compHits.length, 2) * 25 + (relevant.length ? 10 : 0)),
    weight: KOL_WEIGHTS.historicalProductFit,
    reasons: [
      mentionsUs ? "Has mentioned our product" : "Has not covered our product yet (whitespace)",
      compHits.length ? `Has covered: ${compHits.join(", ")}` : "No competitor coverage seen",
    ],
  };

  // AUTHENTICITY — penalise patterns typical of bought reach.
  const reasons: string[] = [];
  let auth = 80;
  if (ctx.followers && ctx.followers > 20_000 && perPost < ctx.followers * 0.0005) {
    auth -= 30;
    reasons.push("Engagement far below follower count (possible inflated audience)");
  }
  const promo = posts.filter((p) => /\b(giveaway|airdrop|100x|moon|not financial advice|nfa|presale)\b/i.test(p.content)).length;
  if (promo) {
    auth -= Math.min(40, promo * 15);
    reasons.push(`${promo} promotional/speculative post(s)`);
  }
  if (discussionRatio > 0.05) {
    auth += 10;
    reasons.push("Real discussion in replies");
  }
  const handleBot = /(?:^|[._-])(?:bot|rss|feed|alerts?)(?:$|[._-])/i.test(ctx.handle ?? "");
  const profileBot = /\b(?:bot account|automated account|automatically posted|auto-post(?:ed|ing)?|rss feed)\b/i.test(`${ctx.displayName ?? ""} ${ctx.bio ?? ""}`)
    || /\b(?:bot|automated)\b/i.test(ctx.displayName ?? "");
  const times = posts.map((post) => post.publishedAt.getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => time - times[index]).filter((gap) => gap > 0);
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / (gaps.length || 1);
  const cadence = gaps.length >= 7 && meanGap >= 30 * 60_000 && meanGap <= 48 * 60 * 60_000
    && Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length) / meanGap < 0.12;
  const linkOnly = posts.length >= 8 && posts.filter((post) => post.content.replace(/https?:\/\/\S+/g, "").replace(/[@#][\w.-]+/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").trim().length < 30).length / posts.length >= 0.75;
  const automated = handleBot || profileBot || (cadence && linkOnly);
  if (automated) {
    auth = Math.min(auth, 25);
    reasons.unshift(handleBot || profileBot ? "Account identifies as an automated feed or bot" : "Very regular posting cadence with mostly link-only posts suggests automation");
  }
  if (!reasons.length) reasons.push("No inauthenticity patterns detected in observed posts");
  const authenticity: ScoreComponent = { score: clamp(auth), weight: KOL_WEIGHTS.authenticity, reasons };

  const weighted = Math.round(
    [audienceFit, topicAuthority, recentRelevance, engagementQuality, narrativeFit, historicalProductFit, authenticity].reduce((s, c) => s + c.score * c.weight, 0),
  );
  const overall = automated ? Math.min(weighted, 34) : weighted;

  // CAMPAIGN FIT — summary used for decisions: needs fit, recency and authenticity together.
  const campaignFit: ScoreComponent = {
    score: clamp(overall * 0.6 + Math.min(audienceFit.score, recentRelevance.score, authenticity.score) * 0.4),
    weight: 0,
    reasons: [
      "Blends overall score with the weakest of audience fit, recency and authenticity",
      !mentionsUs && compHits.length ? "Covers the category but not us — high incremental reach" : mentionsUs ? "Already aware of us — lower incremental reach" : "Category coverage unclear",
    ],
  };

  return { audienceFit, topicAuthority, recentRelevance, engagementQuality, narrativeFit, historicalProductFit, authenticity, campaignFit, overall, relevantPosts: relevant.length };
}
