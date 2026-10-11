import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { activeMission, missionSummary, CATEGORY_LABEL } from "@/server/queries/missions";
import { estimateKolCostMicro } from "@/server/domain/intel/analyze";
import { latestCreatorReport } from "@/server/domain/growth/creator-report";
import { loadPolicy } from "@/server/domain/agent/ledger";
import { DEFAULT_POLICY } from "@/server/domain/agent/policy";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { fmtUsdc } from "@/lib/money";

/**
 * The growth plan: one view of everything GrowTendril proposes for the active mission, grouped into
 * tracks (outreach, creators, content, partnerships, bounties, experiments, research), each tied
 * to its slice of the budget, with who does what. Built only from stored analysis — no guessing.
 */

export type Owner = "growtendril" | "you";
export type TrackKey = "outreach" | "creators" | "content" | "partnerships" | "bounties" | "experiments" | "research";

export interface PlanItem {
  title: string;
  detail: string;
  href: string;
  owner: Owner;
  /** Rough priority 0–100, used to pick the next actions. */
  priority: number;
  costMicro?: number;
  status?: string;
  /** False for generic suggestions that have no collected market evidence yet. */
  evidenceBacked?: boolean;
}

export interface PlanTrack {
  key: TrackKey;
  title: string;
  purpose: string;
  /** Mission budget categories this track draws from. */
  categories: string[];
  allocatedMicro: number;
  usedMicro: number;
  items: PlanItem[];
  empty: string;
}

export interface GrowthPlan {
  mission: { id: string; name: string; goal: string; target: number; achieved: number; daysLeft: number; budgetMicro: number; spentMicro: number; committedMicro: number; availableMicro: number } | null;
  focus: string;
  rules: { autonomyEnabled: boolean; autonomousLimitMicro: number; dailyMicro: number; ceilingMicro: number };
  nextActions: PlanItem[];
  tracks: PlanTrack[];
  learned: { label: string; verdict: string; reason: string }[];
}

const OUTREACH = ["CUSTOMER", "PERSON"];
const PARTNER = ["PARTNERSHIP", "COMMUNITY", "EVENT", "COMPETITOR"];
const CONTENT_STATUS = ["EMERGING", "ACCELERATING", "UNDEREXPLORED", "CONTROVERSIAL"];
const LIVE_EXPERIMENT = ["proposed", "awaiting_approval", "running"];

export async function buildGrowthPlan(db: DB, projectId: string): Promise<GrowthPlan> {
  const mission = await activeMission(db, projectId);
  const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, projectId));
  const [opps, kols, narratives, experiments, approvals, policy] = await Promise.all([
    db
      .select()
      .from(s.opportunities)
      .where(and(eq(s.opportunities.projectId, projectId), inArray(s.opportunities.status, ["open", "researching", "experiment"])))
      .orderBy(desc(s.opportunities.overallScore))
      .limit(60),
    db
      .select()
      .from(s.kols)
      .where(and(eq(s.kols.projectId, projectId), ne(s.kols.status, "dismissed")))
      .orderBy(desc(s.kols.overallScore))
      .limit(6),
    db.select().from(s.narratives).where(eq(s.narratives.projectId, projectId)).orderBy(desc(s.narratives.relevance)).limit(20),
    db.select().from(s.experiments).where(eq(s.experiments.projectId, projectId)).orderBy(desc(s.experiments.createdAt)).limit(20),
    db.select().from(s.approvals).where(and(eq(s.approvals.projectId, projectId), eq(s.approvals.status, "pending"))).orderBy(desc(s.approvals.createdAt)),
    loadPolicy(db, projectId).catch(() => DEFAULT_POLICY),
  ]);
  const sum = mission ? await missionSummary(db, mission) : null;
  const alloc = (cats: string[]) => ({
    allocatedMicro: (sum?.allocation ?? []).filter((a) => cats.includes(a.category)).reduce((n, a) => n + a.allocated, 0),
    usedMicro: (sum?.allocation ?? []).filter((a) => cats.includes(a.category)).reduce((n, a) => n + a.used, 0),
  });
  const consumer = profile?.audience === "consumers";
  const developer = profile?.audience === "developers";

  const outreach: PlanItem[] = opps
    .filter((o) => OUTREACH.includes(o.type))
    .slice(0, 6)
    .map((o) => ({ title: o.title, detail: o.recommendedAction, href: `/app/opportunities/${o.id}`, owner: "you", priority: o.overallScore, status: o.status }));

  const kolOpp = new Map(opps.filter((o) => o.kolId).map((o) => [o.kolId!, o]));
  const report = await latestCreatorReport(db, projectId);
  const fromReport = (report?.entries ?? []).filter((e) => kols.length === 0 || e.tier !== "Watch" || report!.entries.every((x) => x.tier === "Watch")).slice(0, 5);
  const creators: PlanItem[] = fromReport.length
    ? fromReport.map((e) => ({
        title: e.tier === "Watch" ? `${e.name} — watch before paying` : `${e.name} — one sponsored piece`,
        detail: e.tier === "Watch" ? `${e.whyContact[0]}. ${e.risks[0]}.` : e.whyContact.slice(0, 2).join(". ") + ".",
        href: `/app/kols/${e.kolId}/brief`,
        owner: "you" as Owner,
        priority: e.tier === "Contact first" ? e.overall : e.tier === "Worth a test" ? Math.round(e.overall * 0.8) : Math.round(e.overall * 0.4),
        costMicro: e.estimatedCostMicro,
        status: e.tier === "Watch" ? "watch" : e.tier.toLowerCase(),
      }))
    : kols.slice(0, 5).map((k) => {
    const cost = estimateKolCostMicro(k.followers);
    return {
      title: `${k.displayName ?? `@${k.handle}`} — one sponsored piece`,
      detail: k.recommendedAngle ?? k.whyNow[0] ?? "Brief them on one clear idea and a tracked link.",
      href: `/app/kols/${k.id}/brief`,
      owner: "you",
      priority: Math.round(k.overallScore * 0.9),
      costMicro: cost,
      status: kolOpp.get(k.id)?.status === "experiment" ? "experiment" : k.status,
    };
  });

  const content: PlanItem[] = [
    ...narratives
      .filter((n) => CONTENT_STATUS.includes(n.status) || n.velocityPct > 25)
      .slice(0, 4)
      .map((n) => ({
        title: `Publish on "${n.label}"`,
        detail: `${n.volume7d} public post${n.volume7d === 1 ? "" : "s"} this week (${n.velocityPct >= 0 ? "+" : ""}${n.velocityPct}%). ${n.summary && !/week|%/.test(n.summary) ? n.summary : "Answer the questions people are asking, in your own words."}`,
        href: `/app/narratives/${n.id}`,
        owner: "you" as Owner,
        priority: Math.min(100, Math.round(n.relevance * 0.6 + Math.min(40, Math.max(0, n.velocityPct) / 5))),
        status: n.status.toLowerCase(),
      })),
    ...opps
      .filter((o) => o.type === "CONTENT" || o.type === "NARRATIVE")
      .slice(0, 2)
      .map((o) => ({ title: o.title, detail: o.recommendedAction, href: `/app/opportunities/${o.id}`, owner: "you" as Owner, priority: o.overallScore, status: o.status })),
  ];

  const partnerships: PlanItem[] = opps
    .filter((o) => PARTNER.includes(o.type))
    .slice(0, 5)
    .map((o) => ({ title: o.title, detail: o.recommendedAction, href: `/app/opportunities/${o.id}`, owner: "you", priority: o.overallScore, status: o.status }));

  const bountyExps = experiments.filter((e) => e.channel === "bounty");
  const issues = opps.filter((o) => o.type === "PRODUCT_ISSUE").slice(0, 2);
  const bounties: PlanItem[] = [
    ...bountyExps.map((e) => ({ title: e.title, detail: e.hypothesis, href: `/app/experiments/${e.id}`, owner: "growtendril" as Owner, priority: 50, costMicro: e.budgetMicro, status: e.status })),
    ...issues.map((o) => ({
      title: developer ? `Bounty: fix or document "${o.title}"` : `Reward a customer fix for "${o.title}"`,
      detail: `People keep raising this in public. ${o.recommendedAction}`,
      href: `/app/opportunities/${o.id}`,
      owner: "you" as Owner,
      priority: Math.round(o.overallScore * 0.8),
      status: "idea",
    })),
  ];
  if (!bounties.length && mission) {
    bounties.push({
      title: developer ? "Bounty for a tutorial or integration" : consumer ? "Reward the first customers who share a photo or review" : "Referral reward for the first customers who bring a peer",
      detail: developer
        ? "A small USDC bounty for a working example people can copy. Paid only after you approve the result."
        : "A small, disclosed reward per verified post or referral. Paid only after you approve each one.",
      href: "/app/experiments",
      owner: "you",
      priority: 30,
      status: "idea",
      evidenceBacked: false,
    });
  }

  const exps: PlanItem[] = experiments
    .filter((e) => !mission || e.missionId === mission.id)
    .slice(0, 8)
    .map((e) => {
      const goal = EVENT_LABEL[e.successEvent as ConversionEventType] ?? e.successEvent.replace(/_/g, " ");
      return {
        title: `#${e.number} ${e.title}`,
        detail: `${e.successTarget} × ${goal.toLowerCase()} within ${e.timeframeDays} days · stop if cost per result passes ${fmtUsdc(e.stopMaxCpaMicro)} after ${fmtUsdc(e.stopAfterSpendMicro)}.`,
        href: `/app/experiments/${e.id}`,
        owner: e.status === "proposed" || e.status === "awaiting_approval" ? ("you" as Owner) : ("growtendril" as Owner),
        priority: LIVE_EXPERIMENT.includes(e.status) ? 70 : 20,
        costMicro: e.budgetMicro,
        status: e.status,
      };
    });

  const autonomous = policy.autonomyEnabled === true && policy.maxTransactionMicro > 0;
  const research: PlanItem[] = [
    {
      title: autonomous ? `Buy research and data on its own up to ${fmtUsdc(policy.maxTransactionMicro)} each` : "Ask you before buying any research or data",
      detail: autonomous
        ? `Verifies buying intent and enriches top prospects from Circle's Agent Marketplace, within ${fmtUsdc(policy.dailySpendMicro)} a day. Every purchase gets a receipt.`
        : "Raise the autonomous limit in Settings to let GrowTendril verify buying intent and enrich prospects with paid data on its own.",
      href: autonomous ? "/app/activity" : "/app/settings#policy",
      owner: autonomous ? "growtendril" : "you",
      priority: autonomous ? 15 : 25,
    },
  ];

  const tracks: PlanTrack[] = [
    { key: "outreach", title: "Customer outreach", purpose: consumer ? "People asking for what you sell, in public, right now. Reply personally." : "Companies and people showing buying intent. Reach out personally.", categories: ["research"], ...alloc(["research"]), items: outreach, empty: "No one with clear intent yet. Each scan looks again." },
    { key: "creators", title: "Creator campaigns", purpose: "Creators whose audience matches yours, each with a brief. You make the contact; payments need your approval.", categories: ["kol"], ...alloc(["kol"]), items: creators, empty: "No creators scored yet. Build the influencer report to scout some." },
    { key: "content", title: "Content", purpose: "Conversations that are growing in your space. Publishing into them is the cheapest reach there is.", categories: ["content"], ...alloc(["content"]), items: content, empty: "No growing conversations yet." },
    { key: "partnerships", title: "Partnerships & community", purpose: "Communities, events and complementary brands worth working with.", categories: ["community"], ...alloc(["community"]), items: partnerships, empty: "No partnership leads yet." },
    { key: "bounties", title: "Bounties & rewards", purpose: "Small, disclosed rewards for specific results. Paid only after you approve the work.", categories: ["bounty"], ...alloc(["bounty"]), items: bounties, empty: "No bounty ideas yet." },
    { key: "experiments", title: "Experiments", purpose: "Every paid action runs as an experiment with a target and a stop rule, so results decide where the budget goes next.", categories: [], allocatedMicro: sum?.committed ?? 0, usedMicro: sum?.spent ?? 0, items: exps, empty: "No experiments yet. GrowTendril proposes them from the best opportunities." },
    { key: "research", title: "Research & data", purpose: "Paid data and services that sharpen the plan.", categories: ["research", "services"], ...alloc(["services"]), items: research, empty: "" },
  ];

  const nextActions: PlanItem[] = [
    ...approvals.slice(0, 2).map((a) => ({ title: `Decide: ${a.title}`, detail: `Waiting for your approval (${fmtUsdc(a.requestedMicro)}).`, href: "/app/approvals", owner: "you" as Owner, priority: 100, costMicro: a.requestedMicro })),
    ...[outreach[0], creators[0], content[0], partnerships[0], exps.find((e) => e.status === "proposed")].filter((x): x is PlanItem => !!x),
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  // Experiments and research are how the work gets measured, not where to look first.
  const observedPriority = (track: PlanTrack) => Math.max(...track.items.filter((item) => item.evidenceBacked !== false).map((item) => item.priority), -1);
  const ranked = tracks.filter((t) => observedPriority(t) >= 0 && t.key !== "research" && t.key !== "experiments").sort((a, b) => observedPriority(b) - observedPriority(a));
  const goal = mission ? (/^\d/.test(mission.goalDescription) ? mission.goalDescription : `${mission.goalTarget} ${mission.goalDescription}`) : "your first customers";
  const focus = ranked.length
    ? `To reach ${goal}${sum ? ` in ${sum.daysLeft} days with ${fmtUsdc(mission!.budgetMicro)}` : ""}, start with ${ranked
        .slice(0, 2)
        .map((t) => t.title.toLowerCase())
        .join(" and ")}: that's where the strongest signals are right now.`
    : `GrowTendril hasn't found strong signals yet. Run a scan, connect more market sources, or broaden the search terms in Settings.`;

  return {
    mission:
      mission && sum
        ? { id: mission.id, name: mission.name, goal: mission.goalDescription, target: mission.goalTarget, achieved: sum.achieved, daysLeft: sum.daysLeft, budgetMicro: mission.budgetMicro, spentMicro: sum.spent, committedMicro: sum.committed, availableMicro: sum.available }
        : null,
    focus,
    rules: { autonomyEnabled: autonomous, autonomousLimitMicro: autonomous ? policy.maxTransactionMicro : 0, dailyMicro: policy.dailySpendMicro, ceilingMicro: policy.hardCeilingMicro },
    nextActions,
    tracks,
    learned: (sum?.findings ?? []).map((f) => ({ label: f.label, verdict: f.verdict, reason: f.reason })),
  };
}

/** The plan as Markdown, for sharing with a team or pasting into a doc. */
export function planMarkdown(projectName: string, p: GrowthPlan): string {
  const out = [`# Growth plan — ${projectName}`, "", p.focus, ""];
  if (p.mission) {
    out.push(`**Goal:** ${p.mission.goal} — ${p.mission.achieved} of ${p.mission.target} so far, ${p.mission.daysLeft} days left.`);
    out.push(`**Budget:** ${fmtUsdc(p.mission.budgetMicro)} · spent ${fmtUsdc(p.mission.spentMicro)} · committed ${fmtUsdc(p.mission.committedMicro)} · available ${fmtUsdc(p.mission.availableMicro)}`, "");
  }
  out.push(
    `**Spending rules:** ${p.rules.autonomyEnabled ? `GrowTendril may buy research and data on its own up to ${fmtUsdc(p.rules.autonomousLimitMicro)} per payment` : "every payment asks first"}; daily limit ${fmtUsdc(p.rules.dailyMicro)}; hard ceiling ${fmtUsdc(p.rules.ceilingMicro)} per payment. Payments to people always need approval.`,
    "",
    "## Next actions",
    ...p.nextActions.map((a, i) => `${i + 1}. **${a.title}** (${a.owner === "you" ? "you" : "GrowTendril"}) — ${a.detail}`),
    "",
  );
  for (const t of p.tracks) {
    out.push(`## ${t.title}`, "", t.purpose, "");
    if (t.categories.length && t.allocatedMicro) out.push(`Budget: ${fmtUsdc(t.allocatedMicro)} (${t.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}), used ${fmtUsdc(t.usedMicro)}`, "");
    if (!t.items.length) out.push(`_${t.empty}_`, "");
    for (const i of t.items) out.push(`- **${i.title}**${i.costMicro ? ` · est. ${fmtUsdc(i.costMicro)}` : ""} — ${i.detail}`);
    out.push("");
  }
  if (p.learned.length) out.push("## What the results say", ...p.learned.map((l) => `- ${l.label}: **${l.verdict.replace(/_/g, " ")}** — ${l.reason}`), "");
  return out.join("\n");
}
