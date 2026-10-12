import { and, eq, gte } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mergeMode, nextNumber } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { toMicro } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { classifySignals, termHits, SIGNAL_LABEL, type SignalType } from "@/server/domain/intel/signals";
import { clusterNarratives } from "@/server/domain/intel/narratives";
import { analyzeMention, clusterIssues, sentimentOf } from "@/server/domain/intel/mentions";
import { scoreCompany, confidenceFrom, type EvidenceInput } from "@/server/domain/scoring/intent";
import { scoreKol, engagementTotal } from "@/server/domain/scoring/kol";

type Post = typeof s.socialPosts.$inferSelect;
type Mode = (typeof s.dataMode.enumValues)[number];
export type Logger = (agent: string, message: string) => void;

export interface AnalysisStats {
  posts: number;
  companies: number;
  kols: number;
  narratives: number;
  issues: number;
  mentions: number;
  opportunities: number;
}

const RECOMMEND: Partial<Record<SignalType, string>> = {
  recommendation_request: "Answer in the public thread with an honest comparison and a concrete example. Founder posts it; GrowTendril never auto-replies.",
  initiative: "Prepare a tailored demo or proposal for what they announced. Founder decides whether and how to reach out.",
  launch: "Show how you fit what they just launched, in public and only if it genuinely helps them.",
  funding: "Prepare a short, specific plan for their stated goals; founder-led outreach only.",
  hiring: "Their team is growing — share something genuinely useful for their new hires, in public.",
  competitor_usage: "Publish a switching guide that addresses the pain they described with the alternative.",
  complaint: "Address the pain they described with a concrete fix or guide; reply publicly if appropriate.",
  migration: "Offer a clear switching path with a concrete example.",
  github_activity: "Contribute a useful example or integration to their repo only if it adds real value.",
};

function bestSignal(text: string, provider: string, competitors: string[]) {
  return classifySignals(text, { competitors, provider })[0];
}

/** Rough creator-campaign cost estimate — labelled as an estimate everywhere it is shown. */
export function estimateKolCostMicro(followers: number | null | undefined): number {
  if (!followers) return toMicro(75);
  const est = 50 + (followers / 1000) * 1.5;
  return toMicro(Math.min(400, Math.round(est / 25) * 25));
}

const ev = (overall: number): "LOW" | "MEDIUM" | "HIGH" => (overall >= 72 ? "HIGH" : overall >= 55 ? "MEDIUM" : "LOW");
const days = (d: Date, now: number) => Math.max(0, Math.round((now - d.getTime()) / DAY_MS));

export async function analyzeProject(db: DB, projectId: string, log: Logger = () => {}, now = Date.now()): Promise<AnalysisStats> {
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  if (!profile || !project) throw new Error("Project has no product profile yet — finish onboarding first.");
  const icpRows = await db.select().from(s.icps).where(eq(s.icps.projectId, projectId));
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));

  const keywords = [...new Set([...profile.keywords, ...profile.terminology.slice(0, 6)])].filter(Boolean);
  const competitors = profile.competitors;
  const icpTerms = [...new Set(icpRows.flatMap((i) => i.segments).concat(profile.targetUsers.map((t) => t.toLowerCase())))];
  const devAudience = profile.audience === "developers";

  const posts = await db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, projectId), gte(s.socialPosts.publishedAt, new Date(now - 30 * DAY_MS))));
  log("discovery", `Analyzing ${posts.length} public posts from the last 30 days`);
  const text = (p: Post) => `${p.title ?? ""}\n${p.content}`;
  const relevant = (p: Post) => termHits(text(p), keywords).length > 0;

  // ── COMPANIES ───────────────────────────────────────────────
  const byCompany = new Map<string, Post[]>();
  for (const p of posts) {
    const c = p.entities.companies[0];
    if (c) byCompany.set(c, [...(byCompany.get(c) ?? []), p]);
  }
  const companyIds: { id: string; name: string; overall: number; confidence: number; mode: Mode; top: SignalType; whyNow: string[]; scores: Record<string, unknown> }[] = [];
  for (const [name, cps] of byCompany) {
    if (!cps.some(relevant)) continue;
    const mode = mergeMode(cps.map((p) => p.dataMode));
    const [company] = await db
      .insert(s.companies)
      .values({ id: newId(), projectId, name, dataMode: mode, githubOrg: cps.find((p) => p.provider === "github")?.authorHandle ?? null })
      .onConflictDoUpdate({ target: [s.companies.projectId, s.companies.name], set: { updatedAt: new Date() } })
      .returning();

    for (const p of cps) {
      const sig = bestSignal(text(p), p.provider, competitors);
      await db
        .insert(s.evidence)
        .values({
          id: newId(),
          projectId,
          postId: p.id,
          companyId: company.id,
          dedupeKey: `post:${p.id}:company:${company.id}`,
          sourceUrl: p.url,
          sourceTitle: p.title,
          provider: p.provider,
          excerpt: p.content.slice(0, 400),
          signalType: sig.type,
          observedAt: p.publishedAt,
          weight: 1,
          classifiedBy: p.dataMode === "DEMO" ? "demo" : "rule",
          dataMode: p.dataMode,
        })
        .onConflictDoNothing();
    }
    const evRows = await db.select().from(s.evidence).where(eq(s.evidence.companyId, company.id));
    const evInputs: EvidenceInput[] = evRows.map((e) => ({
      signalType: e.signalType as SignalType,
      observedAt: e.observedAt,
      sourceUrl: e.sourceUrl,
      provider: e.provider,
      excerpt: e.excerpt,
      classifiedBy: e.classifiedBy,
      hasNamedPerson: !!cps.find((p) => p.id === e.postId && p.authorHandle.toLowerCase() !== name.toLowerCase()),
    }));
    const sc = scoreCompany(evInputs, { keywords, icpTerms, now });
    const sorted = [...evRows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
    const whyNow = sorted.slice(0, 4).map((e) => `${SIGNAL_LABEL[e.signalType as SignalType]} ${days(e.observedAt, now)}d ago — ${e.excerpt.replace(/\s+/g, " ").slice(0, 110)}`);
    const topSignal = (sc.buyingIntent.reasons.length ? evRows.map((e) => e.signalType as SignalType).sort((a, b) => (RECOMMEND[b] ? 1 : 0) - (RECOMMEND[a] ? 1 : 0))[0] : "mention") as SignalType;
    const strongest = [...evInputs].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()).find((e) => RECOMMEND[e.signalType])?.signalType ?? topSignal;
    const scores = { productFit: sc.productFit, timing: sc.timing, buyingIntent: sc.buyingIntent, evidenceQuality: sc.evidenceQuality, engagementOpportunity: sc.engagementOpportunity };
    const qualified = sc.overall >= 65 && sc.confidence >= 0.8;
    await db
      .update(s.companies)
      .set({
        scores,
        overallScore: sc.overall,
        fitScore: sc.productFit.score,
        intentScore: sc.buyingIntent.score,
        confidence: sc.confidence,
        whyNow,
        whyFit: sc.productFit.reasons.join(". "),
        recommendedAction: RECOMMEND[strongest] ?? "Monitor; not enough intent yet to act.",
        status: company.status === "candidate" || company.status === "qualified" ? (qualified ? "qualified" : "candidate") : company.status,
        dataMode: mergeMode([mode, ...evRows.map((e) => e.dataMode)]),
        updatedAt: new Date(),
      })
      .where(eq(s.companies.id, company.id));
    companyIds.push({ id: company.id, name, overall: sc.overall, confidence: sc.confidence, mode, top: strongest, whyNow, scores });
  }
  log("discovery", `Scored ${companyIds.length} companies with public intent signals`);

  // ── PRODUCT MENTIONS & ISSUES ───────────────────────────────
  const mentionPosts = posts.filter((p) => termHits(text(p), [project.name]).length > 0);
  for (const p of mentionPosts) {
    const a = analyzeMention(text(p), competitors);
    await db
      .insert(s.productMentions)
      .values({ id: newId(), projectId, postId: p.id, sentiment: a.sentiment, categories: a.categories, issueKey: a.issueKey, competitor: a.competitor, churnRisk: a.churnRisk, purchaseIntent: a.purchaseIntent, dataMode: p.dataMode })
      .onConflictDoUpdate({ target: s.productMentions.postId, set: { sentiment: a.sentiment, categories: a.categories, issueKey: a.issueKey } });
  }
  const mentionRows = await db
    .select({ issueKey: s.productMentions.issueKey, publishedAt: s.socialPosts.publishedAt, mode: s.productMentions.dataMode })
    .from(s.productMentions)
    .innerJoin(s.socialPosts, eq(s.productMentions.postId, s.socialPosts.id))
    .where(eq(s.productMentions.projectId, projectId));
  const issues = clusterIssues(mentionRows, now);
  const issueIds: { id: string; key: string; blocks: boolean; label: string; v7: number; change: number; rec: string; mode: Mode }[] = [];
  for (const i of issues) {
    const mode = mergeMode(mentionRows.filter((m) => m.issueKey === i.key).map((m) => m.mode));
    const [row] = await db
      .insert(s.productIssues)
      .values({ id: newId(), projectId, key: i.key, label: i.label, mentions7d: i.mentions7d, mentionsPrev7d: i.mentionsPrev7d, changePct: i.changePct, segment: i.segment, recommendation: i.recommendation, blocksAcquisition: i.blocksAcquisition, dataMode: mode })
      .onConflictDoUpdate({
        target: [s.productIssues.projectId, s.productIssues.key],
        set: { mentions7d: i.mentions7d, mentionsPrev7d: i.mentionsPrev7d, changePct: i.changePct, recommendation: i.recommendation, blocksAcquisition: i.blocksAcquisition, updatedAt: new Date() },
      })
      .returning({ id: s.productIssues.id });
    issueIds.push({ id: row.id, key: i.key, blocks: i.blocksAcquisition, label: i.label, v7: i.mentions7d, change: i.changePct, rec: i.recommendation, mode });
  }
  log("narrative", `${mentionPosts.length} product mentions, ${issues.length} recurring issue theme(s)`);

  // ── NARRATIVES ──────────────────────────────────────────────
  const clusters = clusterNarratives(
    posts.map((p) => ({ id: p.id, text: text(p), publishedAt: p.publishedAt, authorHandle: p.authorHandle, negative: sentimentOf(p.content) === "negative" })),
    { keywords, now },
  );
  const postById = new Map(posts.map((p) => [p.id, p]));
  const narrativeIds: { id: string; key: string; label: string; status: string; relevance: number; velocity: number; v7: number; voices: string[]; terms: string[]; mode: Mode; reason: string }[] = [];
  for (const c of clusters) {
    const cps = c.postIds.map((id) => postById.get(id)!).filter(Boolean);
    const mode = mergeMode(cps.map((p) => p.dataMode));
    const [n] = await db
      .insert(s.narratives)
      .values({ id: newId(), projectId, key: c.key, label: c.label, terms: c.terms, status: c.status, volume7d: c.volume7d, volumePrev7d: c.volumePrev7d, velocityPct: c.velocityPct, relevance: c.relevance, controversy: c.controversy, summary: c.statusReason, dataMode: mode })
      .onConflictDoUpdate({
        target: [s.narratives.projectId, s.narratives.key],
        set: { label: c.label, terms: c.terms, status: c.status, volume7d: c.volume7d, volumePrev7d: c.volumePrev7d, velocityPct: c.velocityPct, relevance: c.relevance, controversy: c.controversy, summary: c.statusReason, dataMode: mode, updatedAt: new Date() },
      })
      .returning({ id: s.narratives.id });
    for (const pid of c.postIds) await db.insert(s.narrativePosts).values({ narrativeId: n.id, postId: pid }).onConflictDoNothing();
    const top = [...cps].sort((a, b) => engagementTotal(b.engagement) - engagementTotal(a.engagement)).slice(0, 4);
    for (const p of top) {
      await db
        .insert(s.evidence)
        .values({ id: newId(), projectId, postId: p.id, narrativeId: n.id, dedupeKey: `post:${p.id}:narrative:${n.id}`, sourceUrl: p.url, sourceTitle: p.title, provider: p.provider, excerpt: p.content.slice(0, 400), signalType: "mention", observedAt: p.publishedAt, classifiedBy: p.dataMode === "DEMO" ? "demo" : "rule", dataMode: p.dataMode })
        .onConflictDoNothing();
    }
    const companiesHere = companyIds.filter((co) => cps.some((p) => p.entities.companies[0] === co.name));
    for (const co of companiesHere) await db.insert(s.narrativeCompanies).values({ narrativeId: n.id, companyId: co.id }).onConflictDoNothing();
    narrativeIds.push({ id: n.id, key: c.key, label: c.label, status: c.status, relevance: c.relevance, velocity: c.velocityPct, v7: c.volume7d, voices: c.voices, terms: c.terms, mode, reason: c.statusReason });
  }
  log("narrative", `Clustered ${clusters.length} narratives: ${clusters.slice(0, 3).map((c) => `${c.label} (${c.velocityPct >= 0 ? "+" : ""}${c.velocityPct}%)`).join(", ")}`);

  // ── KOLs ────────────────────────────────────────────────────
  // Company spokespeople are customers, not KOLs: exclude anyone who posted on behalf of an org.
  const companyVoices = new Set(posts.filter((p) => p.entities.companies.length).map((p) => p.authorHandle.toLowerCase()));
  for (const c of byCompany.keys()) companyVoices.add(c.toLowerCase());
  // One creator, several platforms: group by handle (identity match by handle is flagged as unverified).
  const byAuthor = new Map<string, Post[]>();
  for (const p of posts) {
    const h = p.authorHandle.toLowerCase();
    if (companyVoices.has(h)) continue;
    byAuthor.set(h, [...(byAuthor.get(h) ?? []), p]);
  }
  const narrativeTerms = narrativeIds.filter((n) => n.relevance >= 40).flatMap((n) => n.terms);
  const kolIds: { id: string; handle: string; provider: string; overall: number; campaignFit: number; followers: number | null; whyNow: string[]; angle: string; mode: Mode; scores: Record<string, unknown>; narrativeLabel?: string }[] = [];
  for (const [, aps] of byAuthor) {
    const rel = aps.filter(relevant);
    const eng = rel.reduce((sum, p) => sum + engagementTotal(p.engagement), 0);
    if (!(rel.length >= 2 || (rel.length >= 1 && eng >= 150))) continue;
    // Primary platform = where their on-topic work gets the most engagement.
    const engByProvider = new Map<string, number>();
    for (const p of rel) engByProvider.set(p.provider, (engByProvider.get(p.provider) ?? 0) + engagementTotal(p.engagement) + 1);
    const provider = [...engByProvider.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const platforms = [...new Set(aps.map((p) => p.provider))];
    const handle = aps[0].authorHandle;
    const followers = Math.max(0, ...aps.map((p) => p.authorFollowers ?? 0)) || null;
    // Purchased audience verification (x402) overrides the proxy, if we have it.
    const existing = await db.select().from(s.kols).where(and(eq(s.kols.projectId, projectId), eq(s.kols.provider, provider), eq(s.kols.handle, handle)));
    const verifiedShare = (existing[0]?.metrics as { verifiedAudienceShare?: number } | undefined)?.verifiedAudienceShare ?? null;
    const sc = scoreKol(
      aps.map((p) => ({ content: text(p), publishedAt: p.publishedAt, provider: p.provider, engagement: p.engagement })),
      { keywords, icpTerms, productName: project.name, competitors, narrativeTerms, followers, handle, displayName: aps.find((post) => post.authorName)?.authorName, bio: existing[0]?.profile?.bio, devAudience, verifiedAudienceShare: verifiedShare, now },
    );
    if (sc.overall < 35) continue;
    const mode = mergeMode(aps.map((p) => p.dataMode));
    const narr = narrativeIds.find((n) => n.voices.includes(handle));
    const last7 = rel.filter((p) => now - p.publishedAt.getTime() <= 7 * DAY_MS);
    const mentionsUs = aps.some((p) => termHits(text(p), [project.name]).length);
    const whyNow = [
      `${last7.length} on-topic post(s) this week${narr ? ` in "${narr.label}"` : ""}`,
      devAudience && aps.some((p) => ["github", "hackernews", "youtube"].includes(p.provider)) ? "Publishes on developer-native channels" : `Audience engages with ${termHits(rel.map(text).join(" "), keywords).slice(0, 3).join(", ")}`,
      mentionsUs ? "Has already mentioned us" : `Discusses ${termHits(rel.map(text).join(" "), keywords)[0] ?? "the category"} but has not covered ${project.name}`,
      ...(platforms.length > 1 ? [`Active on ${platforms.join(" + ")} under the same handle (identity match unverified)`] : []),
    ];
    const angle = profile.valueProps[0]
      ? `“${profile.valueProps[0]}” — shown live, in the context of ${narr?.label ?? keywords[0]}`
      : `What ${project.name} changes about ${narr?.label ?? keywords[0]} — shown with a real example`;
    const metrics = {
      audienceFit: sc.audienceFit,
      topicAuthority: sc.topicAuthority,
      recentRelevance: sc.recentRelevance,
      engagementQuality: sc.engagementQuality,
      narrativeFit: sc.narrativeFit,
      historicalProductFit: sc.historicalProductFit,
      authenticity: sc.authenticity,
      campaignFit: sc.campaignFit,
      ...(verifiedShare != null ? { verifiedAudienceShare: verifiedShare } : {}),
    };
    const [kol] = await db
      .insert(s.kols)
      .values({ id: newId(), projectId, provider, handle, displayName: aps.find((p) => p.authorName)?.authorName ?? null, url: aps.find((p) => p.provider === provider)?.authorUrl ?? aps[0].authorUrl, followers, metrics, overallScore: sc.overall, whyNow, recommendedAngle: angle, dataMode: mode })
      .onConflictDoUpdate({ target: [s.kols.projectId, s.kols.provider, s.kols.handle], set: { followers, metrics, overallScore: sc.overall, whyNow, recommendedAngle: angle, dataMode: mode, updatedAt: new Date() } })
      .returning({ id: s.kols.id });
    for (const p of [...rel].sort((a, b) => engagementTotal(b.engagement) - engagementTotal(a.engagement)).slice(0, 3)) {
      await db
        .insert(s.evidence)
        .values({ id: newId(), projectId, postId: p.id, kolId: kol.id, dedupeKey: `post:${p.id}:kol:${kol.id}`, sourceUrl: p.url, sourceTitle: p.title, provider: p.provider, excerpt: p.content.slice(0, 400), signalType: "mention", observedAt: p.publishedAt, classifiedBy: p.dataMode === "DEMO" ? "demo" : "rule", dataMode: p.dataMode })
        .onConflictDoNothing();
    }
    for (const n of narrativeIds.filter((n) => n.voices.includes(handle))) await db.insert(s.narrativeKols).values({ narrativeId: n.id, kolId: kol.id }).onConflictDoNothing();
    kolIds.push({ id: kol.id, handle, provider, overall: sc.overall, campaignFit: sc.campaignFit.score, followers, whyNow, angle, mode, scores: metrics, narrativeLabel: narr?.label });
  }
  log("kol", `Evaluated ${byAuthor.size} authors → ${kolIds.length} relevant voices (ranked by relevance, not followers)`);

  // ── OPPORTUNITIES ───────────────────────────────────────────
  let oppCount = 0;
  async function upsertOpp(o: {
    subjectKey: string;
    type: string;
    secondaryType?: string;
    title: string;
    whyNow: string[];
    recommendedAction: string;
    confidence: number;
    expectedValue: "LOW" | "MEDIUM" | "HIGH";
    estimatedCostMicro: number;
    overallScore: number;
    scores?: Record<string, unknown>;
    companyId?: string;
    kolId?: string;
    narrativeId?: string;
    issueId?: string;
    dataMode: Mode;
  }) {
    const number = await nextNumber(db, "opportunities", projectId);
    await db
      .insert(s.opportunities)
      .values({ id: newId(), projectId, missionId: mission?.id ?? null, number, ...o, scores: o.scores ?? {} })
      .onConflictDoUpdate({
        target: [s.opportunities.projectId, s.opportunities.subjectKey],
        set: { title: o.title, whyNow: o.whyNow, recommendedAction: o.recommendedAction, confidence: o.confidence, expectedValue: o.expectedValue, estimatedCostMicro: o.estimatedCostMicro, overallScore: o.overallScore, scores: o.scores ?? {}, dataMode: o.dataMode, updatedAt: new Date() },
      });
    oppCount++;
  }

  for (const c of companyIds.filter((c) => c.overall >= 45)) {
    await upsertOpp({
      subjectKey: `company:${c.id}`,
      type: "CUSTOMER",
      title: `${c.name} — ${SIGNAL_LABEL[c.top].toLowerCase()}`,
      whyNow: c.whyNow,
      recommendedAction: RECOMMEND[c.top] ?? "Monitor for stronger intent.",
      confidence: c.confidence,
      expectedValue: ev(c.overall),
      estimatedCostMicro: toMicro(25),
      overallScore: c.overall,
      scores: c.scores,
      companyId: c.id,
      dataMode: c.mode,
    });
  }
  for (const k of kolIds.filter((k) => k.overall >= 50)) {
    await upsertOpp({
      subjectKey: `kol:${k.id}`,
      type: "KOL",
      secondaryType: k.narrativeLabel ? "NARRATIVE" : undefined,
      title: `@${k.handle} — ${k.narrativeLabel ?? "creator"}`,
      whyNow: k.whyNow,
      recommendedAction: `Creator campaign. Angle: ${k.angle}. Generate an evidence-backed brief; every payment needs founder approval.`,
      confidence: Math.round(Math.min(0.95, (k.campaignFit / 100) * 1.05) * 100) / 100,
      expectedValue: ev(k.overall),
      estimatedCostMicro: estimateKolCostMicro(k.followers),
      overallScore: k.overall,
      scores: k.scores,
      kolId: k.id,
      dataMode: k.mode,
    });
  }
  const narrativeOppCandidates = narrativeIds
    .filter((n) => ["EMERGING", "ACCELERATING", "UNDEREXPLORED"].includes(n.status) && n.relevance >= 45)
    .sort((a, b) => b.relevance * Math.log10(10 + Math.max(0, b.velocity)) * b.v7 - a.relevance * Math.log10(10 + Math.max(0, a.velocity)) * a.v7)
    .slice(0, 3);
  for (const n of narrativeOppCandidates) {
    const voices = kolIds.filter((k) => n.voices.includes(k.handle));
    await upsertOpp({
      subjectKey: `narrative:${n.id}`,
      type: "NARRATIVE",
      secondaryType: voices.length ? "KOL" : "CONTENT",
      title: `${n.label} is ${n.status.toLowerCase()} (${n.velocity >= 0 ? "+" : ""}${n.velocity}% WoW)`,
      whyNow: [n.reason, `${n.v7} relevant posts this week`, voices.length ? `${voices.length} creator(s) we track post in it: ${voices.map((v) => "@" + v.handle).join(", ")}` : "No dominant voice yet — room to lead", `Relevance to ${project.name}: ${n.relevance}/100`],
      recommendedAction: voices.length ? "Creator campaign anchored on this conversation, plus one piece of content we own." : "Publish the definitive guide, post or demo on this topic to lead the conversation early.",
      confidence: Math.round(Math.min(0.92, 0.45 + n.relevance / 250 + Math.min(0.2, n.v7 / 50)) * 100) / 100,
      expectedValue: n.relevance >= 70 && n.velocity >= 30 ? "HIGH" : "MEDIUM",
      estimatedCostMicro: voices.length ? toMicro(75) : toMicro(30),
      overallScore: Math.round(Math.min(100, n.relevance * 0.6 + Math.min(40, Math.abs(n.velocity) / 3))),
      narrativeId: n.id,
      dataMode: n.mode,
    });
  }
  for (const i of issueIds.filter((i) => i.blocks || i.v7 >= 3)) {
    await upsertOpp({
      subjectKey: `issue:${i.id}`,
      type: "PRODUCT_ISSUE",
      title: `Fix before scaling: ${i.label}`,
      whyNow: [`${i.v7} mentions this week (${i.change >= 0 ? "+" : ""}${i.change}% WoW)`, i.blocks ? "Growing fast enough that paid acquisition would mostly buy more of this friction" : "Recurring theme in product feedback"],
      recommendedAction: i.rec,
      confidence: Math.min(0.9, 0.5 + i.v7 / 25),
      expectedValue: i.blocks ? "HIGH" : "MEDIUM",
      estimatedCostMicro: 0,
      overallScore: Math.min(100, 50 + i.v7 * 4),
      issueId: i.id,
      dataMode: i.mode,
    });
  }
  // Individual people asking in public for exactly what we offer.
  for (const p of posts) {
    if (p.entities.companies.length || !relevant(p)) continue;
    if (kolIds.some((k) => k.handle === p.authorHandle)) continue;
    const sig = bestSignal(text(p), p.provider, competitors);
    if (!["recommendation_request", "question", "competitor_usage"].includes(sig.type)) continue;
    if (now - p.publishedAt.getTime() > 10 * DAY_MS) continue;
    const ageD = days(p.publishedAt, now);
    await upsertOpp({
      subjectKey: `post:${p.id}`,
      type: "PERSON",
      title: `${p.authorHandle} on ${p.provider}: ${SIGNAL_LABEL[sig.type].toLowerCase()}`,
      whyNow: [`${SIGNAL_LABEL[sig.type]} ${ageD}d ago${sig.matched ? ` (“${sig.matched}”)` : ""}`, `Matches: ${termHits(text(p), keywords).join(", ")}`, "Public thread — can be answered in the open"],
      recommendedAction: profile.audience === "developers" ? "Draft a helpful public answer with a runnable example. Founder reviews and posts; no DMs." : "Draft a helpful public answer with a concrete example. Founder reviews and posts; no DMs.",
      confidence: Math.round(confidenceFrom(40, 2) * 100) / 100,
      expectedValue: sig.type === "recommendation_request" ? "MEDIUM" : "LOW",
      estimatedCostMicro: 0,
      overallScore: sig.type === "recommendation_request" ? 62 : 48,
      dataMode: p.dataMode,
    });
  }
  log("operator", `${oppCount} opportunities prioritized`);

  return { posts: posts.length, companies: companyIds.length, kols: kolIds.length, narratives: clusters.length, issues: issues.length, mentions: mentionPosts.length, opportunities: oppCount };
}

export async function evidenceFor(db: DB, where: { companyId?: string; kolId?: string; narrativeId?: string }) {
  if (where.companyId) return db.select().from(s.evidence).where(eq(s.evidence.companyId, where.companyId));
  if (where.kolId) return db.select().from(s.evidence).where(eq(s.evidence.kolId, where.kolId));
  if (where.narrativeId) return db.select().from(s.evidence).where(eq(s.evidence.narrativeId, where.narrativeId));
  return [];
}
