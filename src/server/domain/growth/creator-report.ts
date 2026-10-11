import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { termHits } from "@/server/domain/intel/signals";
import { categoryTerms, rankCategories } from "@/server/domain/intel/market-taxonomy";
import { estimateKolCostMicro } from "@/server/domain/intel/analyze";
import { engagementTotal } from "@/server/domain/scoring/kol";
import { contactRoutes, type ContactRoute } from "@/server/domain/growth/creator-contacts";
import { aiEnabled, aiStructured } from "@/server/integrations/llm";
import { DAY_MS } from "@/lib/time";

/**
 * The influencer report: a ranked, evidence-backed analysis of the creators most worth
 * contacting, with how to reach them (only what they publish themselves) and a draft the
 * founder can personalise. Deterministic by default; Claude may rewrite the prose from the
 * same facts when configured, never the scores.
 */

export type Tier = "Contact first" | "Worth a test" | "Watch";

export interface ReportPost {
  url: string;
  excerpt: string;
  publishedAt: string;
  engagement: number;
}

export interface ReportEntry {
  kolId: string;
  rank: number;
  tier: Tier;
  name: string;
  handle: string;
  provider: string;
  platform: string;
  profileUrl: string | null;
  followers: number | null;
  bio: string | null;
  overall: number;
  scores: { key: string; label: string; score: number; reason: string }[];
  topics: string[];
  postsRead: number;
  relevantPosts: number;
  avgEngagement: number;
  lastActive: string | null;
  recentPosts: ReportPost[];
  contacts: ContactRoute[];
  estimatedCostMicro: number;
  mentionsUs: boolean;
  competitorsCovered: string[];
  whyContact: string[];
  risks: string[];
  approach: string;
  analysis: string;
  outreachDraft: string;
  opportunityId: string | null;
}

export interface CreatorReport {
  generatedAt: string;
  generatedBy: "template" | "claude";
  product: string;
  category: string;
  keywords: string[];
  totals: { creators: number; contactFirst: number; withPublicContact: number; platforms: Record<string, number> };
  topTopics: string[];
  entries: ReportEntry[];
  method: string[];
}

export const PLATFORM_LABEL: Record<string, string> = { bluesky: "Bluesky", x: "X", github: "GitHub", hackernews: "Hacker News", youtube: "YouTube", reddit: "Reddit", rss: "Blog" };
const FORMAT: Record<string, string> = { bluesky: "post or short thread", x: "post or short thread", youtube: "video or a dedicated segment", github: "example project or write-up", hackernews: "honest write-up", reddit: "post", rss: "blog post" };
const SCORE_LABEL: [string, string][] = [
  ["audienceFit", "Audience fit"],
  ["topicAuthority", "Topic authority"],
  ["recentRelevance", "Recent relevance"],
  ["engagementQuality", "Engagement quality"],
  ["narrativeFit", "Conversation fit"],
  ["historicalProductFit", "Covers your space"],
  ["authenticity", "Authenticity"],
];

export function tierFor(e: { overall: number; authenticity: number; daysSinceActive: number | null; offTopic?: boolean; profileFit?: boolean; relevantPosts?: number }): Tier {
  if (e.offTopic) return "Watch";
  // A couple of matching posts from someone whose profile isn't about the field is a coincidence, not a creator.
  if (e.profileFit === false && (e.relevantPosts ?? 0) < 3) return "Watch";
  if (e.overall >= 65 && e.authenticity >= 60 && e.daysSinceActive != null && e.daysSinceActive <= 14) return "Contact first";
  if (e.overall >= 50) return "Worth a test";
  return "Watch";
}

const ORG_NAME = /\s[-|:–—]\s|^the\s|\b(studio|studios|games|bakery|kitchen|co|inc|llc|ltd|lab|labs|team|media|news|official|shop|store|podcast|magazine|club|collective|agency|brand|hq)\b/i;

/** "Sam Baker 🍞" → "Sam"; "The Witch's Bakery - Sunny Lab" → "The Witch's Bakery team". */
export const greetingName = (name: string | null | undefined, handle: string) => {
  const clean = (name ?? "").replace(/[^\p{L}\p{N}\s'&|:–—-]/gu, " ").replace(/\s+/g, " ").trim();
  if (clean && ORG_NAME.test(clean)) {
    const org = clean.split(/\s[-|:–—]\s/)[0].trim();
    return org.length >= 2 && org.length <= 40 ? `${org} team` : `@${handle}`;
  }
  const n = clean.split(" ")[0];
  return n && n.length >= 2 && n.length <= 20 && /^\p{L}/u.test(n) ? n : `@${handle}`;
};

/**
 * A creator whose own profile is clearly about another field (an indie game called "The Witch's
 * Bakery" for a bakery) matched on a word, not an audience. Returns that field, or null.
 */
export function offTopicField(profileText: string, productCategory: string): string | null {
  const ours = productCategory.split(" · ").map((c) => c.trim());
  const ranked = rankCategories(profileText, "");
  const top = ranked[0];
  if (!top || top.score < 4 || ours.includes(top.category.category)) return null;
  const mine = ranked.find((r) => ours.includes(r.category.category))?.score ?? 0;
  return mine * 2 < top.score ? top.category.category : null;
}

const sentence = (text: string, max = 170) => {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return (first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first).trim();
};

/** A personal, honest first message the founder sends themselves. */
export function outreachDraft(c: { name: string | null; handle: string; provider: string; topic: string; excerpt?: string | null }, p: { product: string; summary: string; angle: string; budget?: string | null }): string {
  const platform = PLATFORM_LABEL[c.provider] ?? c.provider;
  const quote = c.excerpt ? ` — especially "${sentence(c.excerpt, 90).replace(/"/g, "'")}"` : "";
  return [
    `Hi ${greetingName(c.name, c.handle)},`,
    "",
    `I've been enjoying your ${platform} posts about ${c.topic}${quote}.`,
    "",
    `I run ${p.product}. ${sentence(p.summary)}`,
    "",
    `Would you be open to a paid ${FORMAT[c.provider] ?? "post"}? The idea: ${p.angle}. You'd have full creative control, it would be clearly marked as sponsored, and I'm happy to send you ${p.product} to try first${p.budget ? ` (budget around ${p.budget})` : ""}.`,
    "",
    "If it isn't a fit, no worries at all.",
    "",
    "Thanks,",
    "[Your name]",
  ].join("\n");
}

type Metric = { score: number; reasons?: string[] };

export async function buildCreatorReport(db: DB, projectId: string, opts: { limit?: number; ai?: boolean; now?: number; onAiError?: (message: string) => void } = {}): Promise<CreatorReport> {
  const now = opts.now ?? Date.now();
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  if (!project || !profile) throw new Error("Finish setting up the workspace first");
  const keywords = [...new Set([...profile.keywords, ...profile.terminology.slice(0, 6)])];
  const kols = await db
    .select()
    .from(s.kols)
    .where(and(eq(s.kols.projectId, projectId), ne(s.kols.status, "dismissed")))
    .orderBy(desc(s.kols.overallScore))
    .limit(opts.limit ?? 15);
  const opps = kols.length
    ? await db.select({ id: s.opportunities.id, kolId: s.opportunities.kolId }).from(s.opportunities).where(and(eq(s.opportunities.projectId, projectId), inArray(s.opportunities.kolId, kols.map((k) => k.id))))
    : [];
  const narr = kols.length
    ? await db
        .select({ kolId: s.narrativeKols.kolId, label: s.narratives.label, velocity: s.narratives.velocityPct })
        .from(s.narrativeKols)
        .innerJoin(s.narratives, eq(s.narrativeKols.narrativeId, s.narratives.id))
        .where(inArray(s.narrativeKols.kolId, kols.map((k) => k.id)))
    : [];

  const entries: ReportEntry[] = [];
  const fits = new Set<string>();
  for (const k of kols) {
    const posts = (await db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, projectId), eq(s.socialPosts.provider, k.provider), eq(s.socialPosts.authorHandle, k.handle)))).sort(
      (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
    );
    const text = (p: (typeof posts)[number]) => `${p.title ?? ""}\n${p.content}`;
    const relevant = posts.filter((p) => termHits(text(p), keywords).length);
    const termCounts = new Map<string, number>();
    for (const p of relevant) for (const t of termHits(text(p), keywords)) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
    const topics = [...termCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 5);
    const allText = posts.map(text).join("\n");
    const mentionsUs = termHits(allText, [project.name]).length > 0;
    const competitorsCovered = termHits(allText, profile.competitors);
    const avgEngagement = relevant.length ? Math.round(relevant.reduce((n, p) => n + engagementTotal(p.engagement), 0) / relevant.length) : 0;
    const lastActive = posts[0]?.publishedAt ?? null;
    const daysSinceActive = lastActive ? Math.floor((now - lastActive.getTime()) / DAY_MS) : null;
    const m = k.metrics as Record<string, Metric | undefined>;
    const scores = SCORE_LABEL.map(([key, label]) => ({ key, label, score: m[key]?.score ?? 0, reason: m[key]?.reasons?.[0] ?? "" }));
    const authenticity = m.authenticity?.score ?? 0;
    const myNarr = narr.filter((n) => n.kolId === k.id);
    const best = [...relevant].sort((a, b) => engagementTotal(b.engagement) - engagementTotal(a.engagement));
    const contacts = contactRoutes(k.provider, { handle: k.handle, displayName: k.displayName ?? undefined, bio: k.profile.bio, links: k.profile.links ?? [], publicEmail: k.profile.publicEmail, url: k.url ?? "" }).filter((c) => c.href);
    const platform = PLATFORM_LABEL[k.provider] ?? k.provider;
    const topic = topics[0] ?? myNarr[0]?.label ?? keywords[0] ?? profile.category;
    const cost = estimateKolCostMicro(k.followers);

    const whyContact = [
      `${relevant.length} of the ${posts.length} recent post${posts.length === 1 ? "" : "s"} we read are about ${topics.slice(0, 3).join(", ") || topic}`,
      ...(myNarr[0] ? [`Active in the "${myNarr[0].label}" conversation (${myNarr[0].velocity >= 0 ? "+" : ""}${myNarr[0].velocity}% this week)`] : []),
      ...(avgEngagement ? [`About ${avgEngagement.toLocaleString()} weighted interactions per on-topic post${(m.engagementQuality?.reasons?.[1] ?? "").includes("Discussion") ? ` · ${m.engagementQuality!.reasons![1].toLowerCase()}` : ""}`] : []),
      mentionsUs ? `Has already mentioned ${project.name} — warm audience` : competitorsCovered.length ? `Covers ${competitorsCovered.join(", ")} but not ${project.name} yet — new audience for you` : `Hasn't covered ${project.name} yet — new audience for you`,
    ];
    const offTopic = offTopicField(`${k.displayName ?? ""}. ${k.profile.bio ?? ""}`, profile.category);
    const profileText = `${k.displayName ?? ""} ${k.handle.replace(/[._-]/g, " ")} ${k.profile.bio ?? ""}`;
    const profileFit = termHits(profileText, [...keywords, ...categoryTerms(profile.category)]).length > 0;
    const risks = [
      ...(offTopic ? [`Their profile is about ${offTopic.toLowerCase()}, not ${profile.category.split(" · ")[0].toLowerCase()} — the overlap may only be a shared word`] : []),
      ...(!offTopic && !profileFit ? [`Their profile doesn't mention ${topic} — check the matching posts aren't a one-off or a figure of speech`] : []),
      ...(authenticity < 60 ? (m.authenticity?.reasons ?? ["Authenticity signals are weak"]).slice(0, 2) : []),
      ...(competitorsCovered.length ? [`Has covered ${competitorsCovered.join(", ")} — ask about existing partnerships`] : []),
      ...(daysSinceActive != null && daysSinceActive > 14 ? [`Quiet recently — last post ${daysSinceActive} days ago`] : []),
      ...(k.followers != null && k.followers < 500 ? ["Small audience — best for a low-cost first test"] : []),
      ...(posts.length >= 5 && relevant.length / posts.length < 0.3 ? ["Mostly posts about other topics"] : []),
      ...(!contacts.some((c) => c.kind !== "profile") ? [`No public email or website — reach out on ${platform}`] : []),
    ];
    const angle = (k.recommendedAngle ?? `showing ${project.name} in the context of ${topic}`).replace(/[“”]/g, '"');
    const approach = `A sponsored ${FORMAT[k.provider] ?? "post"} on ${platform}: ${angle}. Start with one paid piece (est. ${(cost / 1e6).toFixed(0)} USDC) and a tracked link, then decide on more from measured results.`;
    if (profileFit) fits.add(k.id);
    entries.push({
      kolId: k.id,
      rank: 0,
      tier: tierFor({ overall: k.overallScore, authenticity, daysSinceActive, offTopic: !!offTopic, profileFit, relevantPosts: relevant.length }),
      name: k.displayName ?? k.handle,
      handle: k.handle,
      provider: k.provider,
      platform,
      profileUrl: k.url,
      followers: k.followers,
      bio: k.profile.bio ?? null,
      overall: k.overallScore,
      scores,
      topics,
      postsRead: posts.length,
      relevantPosts: relevant.length,
      avgEngagement,
      lastActive: lastActive?.toISOString() ?? null,
      recentPosts: best.slice(0, 3).map((p) => ({ url: p.url, excerpt: p.content.replace(/\s+/g, " ").slice(0, 220), publishedAt: p.publishedAt.toISOString(), engagement: engagementTotal(p.engagement) })),
      contacts,
      estimatedCostMicro: cost,
      mentionsUs,
      competitorsCovered,
      whyContact,
      risks: risks.length ? risks : ["No red flags in the posts we read"],
      approach,
      analysis: `${k.displayName ?? `@${k.handle}`} publishes on ${platform} about ${topics.slice(0, 3).join(", ") || topic}. ${whyContact[0]}. ${authenticity >= 60 ? "Their engagement looks organic." : "Check their engagement before paying."}`,
      outreachDraft: outreachDraft({ name: k.displayName, handle: k.handle, provider: k.provider, topic, excerpt: best[0]?.content }, { product: project.name, summary: profile.summary, angle, budget: `${(cost / 1e6).toFixed(0)} USDC` }),
      opportunityId: opps.find((o) => o.kolId === k.id)?.id ?? null,
    });
  }
  const order: Record<Tier, number> = { "Contact first": 0, "Worth a test": 1, Watch: 2 };
  const fit = (e: ReportEntry) => (fits.has(e.kolId) ? 0 : 1);
  entries.sort((a, b) => order[a.tier] - order[b.tier] || fit(a) - fit(b) || b.overall - a.overall).forEach((e, i) => (e.rank = i + 1));

  const topicCounts = new Map<string, number>();
  for (const e of entries) for (const t of e.topics) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  const report: CreatorReport = {
    generatedAt: new Date(now).toISOString(),
    generatedBy: "template",
    product: project.name,
    category: profile.category,
    keywords: profile.keywords.slice(0, 6),
    totals: {
      creators: entries.length,
      contactFirst: entries.filter((e) => e.tier === "Contact first").length,
      withPublicContact: entries.filter((e) => e.contacts.some((c) => c.kind !== "profile")).length,
      platforms: entries.reduce<Record<string, number>>((acc, e) => ((acc[e.platform] = (acc[e.platform] ?? 0) + 1), acc), {}),
    },
    topTopics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 8),
    entries,
    method: [
      "Creators come from public posts matching your search terms and from profile searches on platforms that offer them.",
      "Each one is scored on what they actually publish: topic authority, recent relevance, engagement quality, conversation fit, whether they cover your space, and authenticity. Follower count only nudges authority.",
      "Contact details are only what the creator lists on their own public profile. GrowTendril never messages anyone — you reach out personally.",
    ],
  };

  if (opts.ai && aiEnabled() && entries.length) {
    const error = await rewriteWithAi(report, profile.summary);
    if (error) opts.onAiError?.(error);
  }
  return report;
}

const AiSchema = z.object({
  creators: z.array(z.object({ handle: z.string(), analysis: z.string(), approach: z.string(), outreach: z.string() })),
});

/** The AI rewrites the prose from the same facts. Scores, contacts and tiers are untouched. */
async function rewriteWithAi(report: CreatorReport, summary: string): Promise<string | undefined> {
  const top = report.entries.slice(0, 8);
  const ai = await aiStructured({
    schema: AiSchema,
    system:
      "You write an influencer analysis for a founder. Use only the facts given; never invent numbers, partnerships or audience data. " +
      "For each creator: 'analysis' = 3-4 sentences on why they fit and what to watch out for; 'approach' = one concrete campaign idea; " +
      "'outreach' = a short, warm, personal first message the founder will send themselves, referencing one real post, offering a clearly disclosed paid collaboration, ending with '[Your name]'.",
    user: JSON.stringify({
      product: report.product,
      summary,
      category: report.category,
      creators: top.map((e) => ({ handle: e.handle, name: e.name, platform: e.platform, followers: e.followers, bio: e.bio, topics: e.topics, whyContact: e.whyContact, risks: e.risks, recentPosts: e.recentPosts.map((p) => p.excerpt), estimatedBudgetUsdc: Math.round(e.estimatedCostMicro / 1e6) })),
    }),
    effort: "low",
  });
  if (!ai.data) return ai.error ?? "no output";
  for (const c of ai.data.creators) {
    const e = top.find((x) => x.handle.toLowerCase() === c.handle.toLowerCase());
    if (!e) continue;
    e.analysis = c.analysis;
    e.approach = c.approach;
    e.outreachDraft = c.outreach;
  }
  report.generatedBy = "claude";
}

export async function saveCreatorReport(db: DB, projectId: string, report: CreatorReport) {
  await db.insert(s.creatorReports).values({ id: newId(), projectId, data: report as unknown as Record<string, unknown>, generatedBy: report.generatedBy });
}

export async function latestCreatorReport(db: DB, projectId: string): Promise<CreatorReport | null> {
  const [row] = await db.select().from(s.creatorReports).where(eq(s.creatorReports.projectId, projectId)).orderBy(desc(s.creatorReports.createdAt)).limit(1);
  return row ? (row.data as unknown as CreatorReport) : null;
}

/** Markdown export: readable as-is, easy to paste into a doc or send to a teammate. */
export function reportMarkdown(r: CreatorReport): string {
  const lines = [
    `# Influencer report — ${r.product}`,
    "",
    `Generated ${new Date(r.generatedAt).toUTCString()} · ${r.category} · ${r.totals.creators} creators · ${r.totals.contactFirst} to contact first`,
    "",
    `**Searching for:** ${r.keywords.join(", ")}`,
    r.topTopics.length ? `**What these creators talk about:** ${r.topTopics.join(", ")}` : "",
    "",
  ];
  for (const e of r.entries) {
    lines.push(
      `## ${e.rank}. ${e.name} (@${e.handle}) — ${e.tier}`,
      "",
      `${e.platform}${e.followers != null ? ` · ${e.followers.toLocaleString()} followers` : ""} · score ${e.overall}/100 · est. ${(e.estimatedCostMicro / 1e6).toFixed(0)} USDC${e.profileUrl ? ` · ${e.profileUrl}` : ""}`,
      "",
      e.analysis,
      "",
      "**Why contact them**",
      ...e.whyContact.map((w) => `- ${w}`),
      "",
      "**How to reach them**",
      ...e.contacts.map((c) => `- ${c.label}: ${c.kind === "email" ? c.value : c.href} (${c.note})`),
      "",
      "**Risks**",
      ...e.risks.map((x) => `- ${x}`),
      "",
      `**Suggested approach:** ${e.approach}`,
      "",
      "**Recent posts**",
      ...e.recentPosts.map((p) => `- ${p.excerpt.slice(0, 140)} — ${p.url}`),
      "",
      "**Draft message**",
      "",
      ...e.outreachDraft.split("\n").map((l) => `> ${l}`),
      "",
    );
  }
  lines.push("---", "", ...r.method.map((m) => `_${m}_`));
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

export function reportCsv(r: CreatorReport): string {
  const head = ["rank", "tier", "name", "handle", "platform", "followers", "score", "topics", "email", "website", "profile", "est_cost_usdc", "why", "risks", "draft_message"];
  const rows = r.entries.map((e) => [
    e.rank,
    e.tier,
    e.name,
    `@${e.handle}`,
    e.platform,
    e.followers ?? "",
    e.overall,
    e.topics.join("; "),
    e.contacts.find((c) => c.kind === "email")?.value ?? "",
    e.contacts.find((c) => c.kind === "website")?.href ?? "",
    e.profileUrl ?? "",
    (e.estimatedCostMicro / 1e6).toFixed(0),
    e.whyContact.join(" | "),
    e.risks.join(" | "),
    e.outreachDraft,
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
