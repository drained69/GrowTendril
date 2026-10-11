import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { claudeStructured } from "@/server/integrations/llm/claude";
import { fmtUsdc } from "@/lib/money";
import { buildUtmUrl } from "@/server/domain/growth/attribution-links";

/**
 * KOL BRIEF — a working document for a creator, not ad copy. Every claim cites a source.
 * Drafts (X post, thread, video points…) are clearly marked as *suggestions for the creator
 * to rewrite in their own voice* — GrowTendril never posts as, or impersonates, anyone.
 */

export interface KolBrief {
  creator: string;
  objective: string;
  whyThisCreator: string[];
  whyNow: string[];
  audience: string;
  currentNarrative: string;
  coreIdea: string;
  productProof: { claim: string; source: string }[];
  demoWorthShowing: string;
  suggestedAngles: string[];
  claimsWithEvidence: { claim: string; source: string }[];
  thingsToAvoid: string[];
  cta: string;
  trackingLink: string | null;
  creatorFreedom: "HIGH" | "MEDIUM";
  compensation: string;
  drafts: { label: string; body: string }[];
  draftsGeneratedBy: "claude" | "template";
  disclosure: string;
}

const DraftsSchema = z.object({
  xDraft: z.string(),
  threadOutline: z.array(z.string()).max(8),
  videoTalkingPoints: z.array(z.string()).max(8),
  shortVideoConcept: z.string(),
  youtubeOutline: z.array(z.string()).max(10),
});

export async function generateKolBrief(db: DB, kolId: string, experimentId?: string): Promise<KolBrief> {
  const [kol] = await db.select().from(s.kols).where(eq(s.kols.id, kolId));
  if (!kol) throw new Error("KOL not found");
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, kol.projectId));
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, kol.projectId));
  const kolEvidence = await db.select().from(s.evidence).where(eq(s.evidence.kolId, kol.id));
  const narrLinks = await db.select({ n: s.narratives }).from(s.narrativeKols).innerJoin(s.narratives, eq(s.narrativeKols.narrativeId, s.narratives.id)).where(eq(s.narrativeKols.kolId, kol.id));
  const narrative = narrLinks.map((l) => l.n).sort((a, b) => b.relevance - a.relevance)[0];
  const narrEvidence = narrative ? await db.select().from(s.evidence).where(eq(s.evidence.narrativeId, narrative.id)) : [];
  const exp = experimentId ? (await db.select().from(s.experiments).where(eq(s.experiments.id, experimentId)))[0] : undefined;
  const campaign = exp ? (await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id)))[0] : undefined;
  const [mission] = exp ? await db.select().from(s.missions).where(eq(s.missions.id, exp.missionId)) : [];
  const m = kol.metrics as Record<string, { score: number; reasons: string[] }>;

  const siteSource = profile.crawledSources.find((c) => c.ok)?.url ?? project.website ?? "founder-provided description";
  const productProof = profile.valueProps.slice(0, 4).map((v) => ({ claim: v, source: siteSource }));
  const tracking = campaign
    ? buildUtmUrl(campaign.destinationUrl, { source: campaign.utmSource, medium: campaign.utmMedium, campaign: campaign.utmCampaign, ref: campaign.referralCode })
    : null;
  const narrativeLabel = narrative?.label ?? profile.keywords[0] ?? profile.category;

  const brief: KolBrief = {
    creator: `@${kol.handle} (${kol.provider})`,
    objective: mission ? `${mission.goalDescription} — introduce ${profile.targetUsers[0]?.toLowerCase() ?? "developers"} to ${project.name}` : `Introduce ${profile.targetUsers[0]?.toLowerCase() ?? "developers"} to ${project.name}`,
    whyThisCreator: [
      ...(m.topicAuthority?.reasons ?? []).slice(0, 2),
      ...(m.audienceFit?.reasons ?? []).slice(0, 1),
      `Authenticity: ${m.authenticity?.score ?? "?"}/100 — ${(m.authenticity?.reasons ?? [])[0] ?? ""}`,
    ],
    whyNow: kol.whyNow,
    audience: (m.audienceFit?.reasons ?? []).join(". "),
    currentNarrative: narrative ? `${narrative.label}: ${narrative.status} (${narrative.velocityPct >= 0 ? "+" : ""}${narrative.velocityPct}% WoW, ${narrative.volume7d} posts this week)` : "No dominant narrative detected",
    coreIdea: kol.recommendedAngle ?? `Show what ${project.name} makes possible in ${narrativeLabel}.`,
    productProof,
    demoWorthShowing: profile.useCases[0] ? `Live: ${profile.useCases[0]}` : `Live, unedited: install ${project.name} and complete the core flow end to end`,
    suggestedAngles: [
      kol.recommendedAngle ?? `${narrativeLabel}, made practical`,
      `What changes for ${profile.targetUsers[0] ?? "developers"} when ${narrativeLabel.toLowerCase()} works without the usual setup`,
      `An honest comparison: ${project.name} vs. doing it yourself${profile.competitors.length ? ` or ${profile.competitors[0]}` : ""}`,
    ],
    claimsWithEvidence: [
      ...productProof,
      ...narrEvidence.slice(0, 3).map((e) => ({ claim: `Market context: ${e.excerpt.slice(0, 120)}`, source: e.sourceUrl })),
      ...kolEvidence.slice(0, 2).map((e) => ({ claim: `Creator's prior coverage: ${e.excerpt.slice(0, 100)}`, source: e.sourceUrl })),
    ],
    thingsToAvoid: ["Unsupported claims — only use the claims listed with sources", "Price or token speculation", 'Generic "future of Web3" language', "Implying endorsement beyond what you actually tested", "Undisclosed sponsorship — always disclose"],
    cta: mission?.goalEvent === "sdk_key_created" ? `Try the SDK — create a key via the tracking link` : `Try ${project.name} via the tracking link`,
    trackingLink: tracking,
    creatorFreedom: "HIGH",
    compensation: exp ? `${fmtUsdc(exp.budgetMicro)} in two tranches (USDC on Arc); second tranche released only if results are on track` : "To be agreed",
    drafts: [],
    draftsGeneratedBy: "template",
    disclosure: "Drafts below are suggestions for the creator to rewrite in their own voice. GrowTendril never posts on anyone's behalf.",
  };

  const ai = await claudeStructured({
    schema: DraftsSchema,
    system:
      "You write suggested creator drafts for a sponsored technical campaign. Only use the claims provided, never invent metrics, include a sponsorship disclosure (#ad or 'sponsored'), no price speculation, no hype. Write so the creator can easily rewrite in their own voice.",
    user: JSON.stringify({ product: project.name, creator: brief.creator, coreIdea: brief.coreIdea, angles: brief.suggestedAngles, claims: brief.claimsWithEvidence.map((c) => c.claim), cta: brief.cta, link: tracking }),
    effort: "low",
  });
  if (ai.data) {
    brief.draftsGeneratedBy = "claude";
    brief.drafts = [
      { label: "X draft", body: ai.data.xDraft },
      { label: "Thread outline", body: ai.data.threadOutline.map((t, i) => `${i + 1}. ${t}`).join("\n") },
      { label: "Video talking points", body: ai.data.videoTalkingPoints.map((t) => `• ${t}`).join("\n") },
      { label: "TikTok / Reels concept", body: ai.data.shortVideoConcept },
      { label: "YouTube outline", body: ai.data.youtubeOutline.map((t, i) => `${i + 1}. ${t}`).join("\n") },
    ];
  } else {
    brief.drafts = [
      { label: "X draft", body: `Sponsored by ${project.name} — I spent a day on ${narrativeLabel.toLowerCase()}. ${brief.productProof[0]?.claim ?? ""}. What surprised me: [your honest take]. Try it: ${tracking ?? "[link]"}` },
      { label: "Thread outline", body: [`The problem with ${narrativeLabel.toLowerCase()} today`, "What I tried", `Where ${project.name} fits (and where it doesn't)`, "Live demo", "Verdict + link (sponsored)"].map((t, i) => `${i + 1}. ${t}`).join("\n") },
      { label: "Video talking points", body: brief.suggestedAngles.map((a) => `• ${a}`).join("\n") },
      { label: "TikTok / Reels concept", body: `60s: "${brief.coreIdea}" — screen-recorded, one take, ends on the result. Disclose sponsorship on screen.` },
      { label: "YouTube outline", body: ["Cold open: the result", "Context: " + narrativeLabel, "Build it live", "Trade-offs", "CTA + disclosure"].map((t, i) => `${i + 1}. ${t}`).join("\n") },
    ];
  }

  if (campaign) await db.update(s.campaigns).set({ brief: brief as unknown as Record<string, unknown> }).where(eq(s.campaigns.id, campaign.id));
  return brief;
}

export async function evidenceByIds(db: DB, ids: string[]) {
  return ids.length ? db.select().from(s.evidence).where(inArray(s.evidence.id, ids)) : [];
}
