import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, max, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit, nextNumber } from "@/server/db/helpers";
import { newId, sha256, shortCode } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal } from "@/lib/money";
import { DAY_MS, relTime } from "@/lib/time";
import { missionSpend, experimentSpend } from "@/server/domain/agent/ledger";
import { proposeFinancialAction, type ProposalOutcome } from "@/server/domain/agent/execute";
import { EVENT_LABEL, utmSlug, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { ARC } from "@/server/integrations/circle/config";
import { capReward, detectDisclosure, normalizeHandle, PLATFORM_LABEL, planCampaign, qualityScore, releaseToWinners, validPostUrl } from "@/server/domain/growth/campaign-plan";
import { getEconomics, planRules } from "@/server/domain/growth/economics";

/**
 * CREATOR CAMPAIGNS — opt-in, measurable creator programs.
 *
 * A business sets the action it wants, the most it can afford per action and a test budget.
 * Creators join through a public link and agree to the rules (including disclosure) before
 * posting. Reviewers accept posts against a rubric; verified customer actions arrive through the
 * creator's own tracking link. Every reward line states its reason and evidence, every ceiling is
 * enforced in code, and payouts go through the same policy engine, approval inbox and transaction
 * state machine as every other payment. Nothing is paid that wasn't earned.
 */

export type Campaign = typeof s.creatorCampaigns.$inferSelect;
export type Participant = typeof s.campaignParticipants.$inferSelect;
export type Reward = typeof s.campaignRewards.$inferSelect;

const PAID = ["SUBMITTED", "SETTLED"];
const IN_FLIGHT = ["PROPOSED", "AWAITING_APPROVAL", "AUTHORIZED", "EXECUTING"];
const RETURNED = ["DENIED", "REJECTED", "FAILED"];
/** Conversions that happen shortly after the window closes still came from campaign posts. */
export const ATTRIBUTION_GRACE_DAYS = 7;

const token = () => randomBytes(24).toString("base64url");
export const ceilingOf = (c: Campaign, p: Participant) => p.ceilingMicro ?? c.creatorCapMicro;
const isOpen = (c: Campaign, now = Date.now()) => c.status === "open" && now >= c.startsAt.getTime() && now <= c.endsAt.getTime();

export async function getCampaign(db: DB, projectId: string, id: string) {
  const [c] = await db.select().from(s.creatorCampaigns).where(and(eq(s.creatorCampaigns.projectId, projectId), eq(s.creatorCampaigns.id, id)));
  return c ?? null;
}

// ───────────────────────────── create ─────────────────────────────

export interface CreateCampaignInput {
  projectId: string;
  userId: string;
  name: string;
  topic: string;
  topicTerms: string[];
  brief: string;
  destinationUrl: string;
  targetEvent: ConversionEventType;
  maxCostPerActionMicro: number;
  budgetMicro: number;
  days: number;
  postsPerCreator: number;
  creators?: number;
  platforms: string[];
  disclosureText: string;
}

/** Budget a campaign may reserve from the active mission: budget − spent − awaiting approval − reserved by open experiments. */
export async function missionRoom(db: DB, mission: typeof s.missions.$inferSelect): Promise<number> {
  const { spent, pending } = await missionSpend(db, mission.id);
  const open = await db.select().from(s.experiments).where(and(eq(s.experiments.missionId, mission.id), inArray(s.experiments.status, ["proposed", "awaiting_approval", "running"])));
  let reserved = 0;
  for (const x of open) reserved += Math.max(0, x.budgetMicro - (await experimentSpend(db, x.id)));
  return Math.max(0, mission.budgetMicro - spent - pending - reserved);
}

export async function createCampaign(db: DB, a: CreateCampaignInput): Promise<Campaign> {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, a.projectId));
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, a.projectId), eq(s.missions.status, "active")));
  if (!mission) throw new Error("Create a mission first — campaign budgets are reserved from the active mission");
  const room = await missionRoom(db, mission);
  if (a.budgetMicro > room) throw new Error(`The mission has ${fmtUsdc(room)} unreserved — lower the test budget or raise the mission budget`);
  if (a.maxCostPerActionMicro > a.budgetMicro) throw new Error("The test budget must cover at least one action");
  const econ = await getEconomics(db, a.projectId);
  const plan = planCampaign({ budgetMicro: a.budgetMicro, maxCostPerActionMicro: a.maxCostPerActionMicro, days: a.days, postsPerCreator: a.postsPerCreator, creators: a.creators, actionLabel: EVENT_LABEL[a.targetEvent]?.toLowerCase(), rules: planRules(econ.values), rulesSource: econ.saved ? "setting" : "starting" });
  const now = new Date();
  const ends = new Date(now.getTime() + plan.days * DAY_MS);
  const dataMode = project.dataMode === "DEMO" ? "DEMO" : "LIVE";
  const expNumber = await nextNumber(db, "experiments", a.projectId);
  const [exp] = await db
    .insert(s.experiments)
    .values({
      id: newId(),
      projectId: a.projectId,
      missionId: mission.id,
      number: expNumber,
      title: `Creator campaign — ${a.name}`,
      hypothesis: `Opt-in creators who publish useful ${a.topic} content will drive ${EVENT_LABEL[a.targetEvent]?.toLowerCase() ?? a.targetEvent} at or below ${fmtUsdc(a.maxCostPerActionMicro)} each.`,
      channel: "kol",
      budgetCategory: "kol",
      target: `Up to ${plan.creators} opt-in creators on ${a.topic}`,
      action: `Pay ${fmtUsdc(plan.basePayMicro)} per accepted post (max ${plan.postsPerCreator}), up to ${fmtUsdc(plan.discussionBonusCapMicro)} per post for useful discussion, ${fmtUsdc(plan.actionBonusMicro)} per verified action`,
      budgetMicro: a.budgetMicro,
      successEvent: a.targetEvent,
      successTarget: Math.max(1, plan.actionsAtFullSpend),
      stopMaxCpaMicro: a.maxCostPerActionMicro,
      stopAfterSpendMicro: Math.round(a.budgetMicro / 2),
      timeframeDays: plan.days,
      startsAt: now,
      endsAt: ends,
      status: "running",
      dataMode,
    })
    .returning();
  const [{ n }] = await db.select({ n: max(s.creatorCampaigns.number) }).from(s.creatorCampaigns).where(eq(s.creatorCampaigns.projectId, a.projectId));
  const [c] = await db
    .insert(s.creatorCampaigns)
    .values({
      id: newId(),
      projectId: a.projectId,
      experimentId: exp.id,
      number: (n ?? 0) + 1,
      name: a.name,
      topic: a.topic,
      topicTerms: a.topicTerms,
      brief: a.brief,
      destinationUrl: a.destinationUrl,
      targetEvent: a.targetEvent,
      maxCostPerActionMicro: a.maxCostPerActionMicro,
      budgetMicro: a.budgetMicro,
      basePayMicro: plan.basePayMicro,
      maxPostsPerCreator: plan.postsPerCreator,
      discussionBonusCapMicro: plan.discussionBonusCapMicro,
      actionBonusMicro: plan.actionBonusMicro,
      creatorCapMicro: plan.creatorCapMicro,
      maxCreators: plan.creators,
      disclosureText: a.disclosureText,
      platforms: a.platforms,
      plan: plan as unknown as Record<string, unknown>,
      releasedMicro: plan.testPhaseMicro,
      holdbackDays: plan.holdbackDays,
      joinToken: token(),
      startsAt: now,
      endsAt: ends,
      createdBy: a.userId,
      dataMode,
    })
    .returning();
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.create", target: c.id, data: { budget: a.budgetMicro, maxCpa: a.maxCostPerActionMicro } });
  return c;
}

export async function closeCampaign(db: DB, a: { projectId: string; campaignId: string; userId: string }) {
  const c = await getCampaign(db, a.projectId, a.campaignId);
  if (!c) throw new Error("Campaign not found");
  await syncActionRewards(db, c);
  const actions = await db.select({ n: sql<number>`count(*)::int` }).from(s.campaignRewards).where(and(eq(s.campaignRewards.campaignId, c.id), eq(s.campaignRewards.kind, "action"), isNull(s.campaignRewards.voidedAt)));
  const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, c.experimentId));
  await db.update(s.creatorCampaigns).set({ status: "closed", updatedAt: new Date() }).where(eq(s.creatorCampaigns.id, c.id));
  await db.update(s.experiments).set({ status: (actions[0]?.n ?? 0) >= (exp?.successTarget ?? 1) ? "succeeded" : "stopped", updatedAt: new Date() }).where(eq(s.experiments.id, c.experimentId));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.close", target: c.id });
}

// ───────────────────────────── creators ─────────────────────────────

export async function campaignByJoinToken(db: DB, joinToken: string) {
  const [c] = await db.select().from(s.creatorCampaigns).where(eq(s.creatorCampaigns.joinToken, joinToken));
  if (!c) return null;
  const [project] = await db.select({ name: s.projects.name, website: s.projects.website }).from(s.projects).where(eq(s.projects.id, c.projectId));
  const [{ accepted }] = await db.select({ accepted: sql<number>`count(*)::int` }).from(s.campaignParticipants).where(and(eq(s.campaignParticipants.campaignId, c.id), eq(s.campaignParticipants.status, "accepted")));
  return { campaign: c, projectName: project?.name ?? "", website: project?.website ?? null, acceptedCreators: accepted ?? 0, open: isOpen(c) };
}

export interface JoinInput {
  provider: string;
  handle: string;
  displayName?: string;
  contact?: string;
  payoutAddress: string;
  pitch?: string;
  agreeRules: boolean;
  agreeDisclosure: boolean;
}

/** A creator applies. Returns the private access token for their contribution page (shown once). */
export async function joinCampaign(db: DB, joinToken: string, j: JoinInput): Promise<{ accessToken: string; participantId: string }> {
  const found = await campaignByJoinToken(db, joinToken);
  if (!found) throw new Error("This campaign link is not valid");
  const c = found.campaign;
  if (!found.open) throw new Error("This campaign is not accepting creators");
  if (!j.agreeRules || !j.agreeDisclosure) throw new Error("You need to accept the rules and the disclosure requirement to join");
  if (!c.platforms.includes(j.provider)) throw new Error("This campaign doesn't include that platform");
  const handle = normalizeHandle(j.handle);
  if (!/^[a-z0-9_.-]{1,64}$/i.test(handle)) throw new Error("Enter your handle without spaces");
  if (!/^0x[0-9a-fA-F]{40}$/.test(j.payoutAddress.trim())) throw new Error("Payout address must be a 0x… address on Arc");
  if (/^0x0{40}$/i.test(j.payoutAddress.trim()) || /dead$/i.test(j.payoutAddress.trim())) throw new Error("That payout address can't receive funds");
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(s.campaignParticipants).where(eq(s.campaignParticipants.campaignId, c.id));
  if ((total ?? 0) >= Math.max(50, c.maxCreators * 5)) throw new Error("This campaign has received the maximum number of applications");
  const accessToken = token();
  const [existing] = await db.select({ id: s.campaignParticipants.id }).from(s.campaignParticipants).where(and(eq(s.campaignParticipants.campaignId, c.id), eq(s.campaignParticipants.provider, j.provider), eq(s.campaignParticipants.handle, handle)));
  if (existing) throw new Error("That handle has already applied to this campaign");
  const [p] = await db
    .insert(s.campaignParticipants)
    .values({
      id: newId(),
      campaignId: c.id,
      projectId: c.projectId,
      provider: j.provider,
      handle,
      displayName: j.displayName?.trim().slice(0, 80) || null,
      contact: j.contact?.trim().slice(0, 120) || null,
      payoutAddress: j.payoutAddress.trim(),
      pitch: j.pitch?.trim().slice(0, 600) || null,
      accessTokenHash: sha256(accessToken),
      termsAcceptedAt: new Date(),
    })
    .returning({ id: s.campaignParticipants.id });
  await audit(db, { projectId: c.projectId, actorType: "system", action: "campaign.apply", target: c.id, data: { provider: j.provider, handle } });
  return { accessToken, participantId: p.id };
}

export async function participantByToken(db: DB, accessToken: string) {
  if (!accessToken || accessToken.length < 16) return null;
  const [p] = await db.select().from(s.campaignParticipants).where(eq(s.campaignParticipants.accessTokenHash, sha256(accessToken)));
  if (!p) return null;
  const [c] = await db.select().from(s.creatorCampaigns).where(eq(s.creatorCampaigns.id, p.campaignId));
  return c ? { participant: p, campaign: c } : null;
}

/** Accept or decline an applicant. Accepting gives them their own tracking link for attribution. */
export async function decideParticipant(db: DB, a: { projectId: string; campaignId: string; participantId: string; accept: boolean; userId: string }) {
  const c = await getCampaign(db, a.projectId, a.campaignId);
  if (!c) throw new Error("Campaign not found");
  const [p] = await db.select().from(s.campaignParticipants).where(and(eq(s.campaignParticipants.id, a.participantId), eq(s.campaignParticipants.campaignId, c.id)));
  if (!p) throw new Error("Creator not found");
  if (!a.accept) {
    if (p.status === "accepted") {
      const [{ earned }] = await db.select({ earned: sql<number>`count(*)::int` }).from(s.campaignRewards).where(and(eq(s.campaignRewards.participantId, p.id), isNull(s.campaignRewards.voidedAt)));
      if (earned) throw new Error("This creator has earned rewards — close the campaign instead of removing them");
    }
    await db.update(s.campaignParticipants).set({ status: p.status === "accepted" ? "removed" : "declined", decidedAt: new Date() }).where(eq(s.campaignParticipants.id, p.id));
    await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.decline", target: p.id });
    return;
  }
  if (p.status === "accepted") return;
  const [{ accepted }] = await db.select({ accepted: sql<number>`count(*)::int` }).from(s.campaignParticipants).where(and(eq(s.campaignParticipants.campaignId, c.id), eq(s.campaignParticipants.status, "accepted")));
  if ((accepted ?? 0) >= c.maxCreators) throw new Error(`The plan funds ${c.maxCreators} creators — all places are filled`);
  let trackingId = p.trackingCampaignId;
  if (!trackingId) {
    const [t] = await db
      .insert(s.campaigns)
      .values({
        id: newId(),
        experimentId: c.experimentId,
        name: `${c.name} — @${p.handle}`,
        channel: "kol",
        utmSource: p.provider,
        utmMedium: "creator",
        utmCampaign: utmSlug(c.name),
        referralCode: shortCode(10),
        destinationUrl: c.destinationUrl,
        brief: { creatorCampaignId: c.id, participantId: p.id },
      })
      .returning({ id: s.campaigns.id });
    trackingId = t.id;
  }
  const [kol] = await db.select().from(s.kols).where(and(eq(s.kols.projectId, a.projectId), eq(s.kols.provider, p.provider), sql`lower(${s.kols.handle}) = ${p.handle}`));
  if (kol) await db.update(s.kols).set({ status: "engaged" }).where(eq(s.kols.id, kol.id));
  await db.update(s.campaignParticipants).set({ status: "accepted", trackingCampaignId: trackingId, kolId: kol?.id ?? null, decidedAt: new Date() }).where(eq(s.campaignParticipants.id, p.id));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.accept", target: p.id });
}

// ───────────────────────────── posts & review ─────────────────────────────

export async function submitPost(db: DB, accessToken: string, a: { url: string; note?: string }) {
  const found = await participantByToken(db, accessToken);
  if (!found) throw new Error("This link is not valid");
  const { participant: p, campaign: c } = found;
  if (p.status !== "accepted") throw new Error("You can submit posts once the business accepts your application");
  if (!isOpen(c)) throw new Error("This campaign is closed for submissions");
  const bad = validPostUrl(a.url, p.provider);
  if (bad) throw new Error(bad);
  const url = new URL(a.url.trim()).toString();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.campaignPosts).where(eq(s.campaignPosts.participantId, p.id));
  if ((n ?? 0) >= c.maxPostsPerCreator * 3) throw new Error("You've reached the submission limit for this campaign");
  // Match against what GrowthOS already observed from public sources (never fetched on demand).
  const [observed] = await db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, c.projectId), eq(s.socialPosts.url, url)));
  const [row] = await db
    .insert(s.campaignPosts)
    .values({ id: newId(), campaignId: c.id, participantId: p.id, url, note: a.note?.trim().slice(0, 400) || null, observedPostId: observed?.id ?? null, disclosureDetected: detectDisclosure(observed ? `${observed.title ?? ""} ${observed.content}` : null, c.disclosureText) })
    .onConflictDoNothing({ target: [s.campaignPosts.campaignId, s.campaignPosts.url] })
    .returning({ id: s.campaignPosts.id });
  if (!row) throw new Error("That post was already submitted");
  return row.id;
}

export interface ReviewInput {
  relevance: number;
  depth: number;
  accuracy: number;
  disclosure: boolean;
  discussion: number;
  note: string;
}

async function earnedTotals(db: DB, campaignId: string, participantId: string) {
  const [r] = await db
    .select({
      creator: sql<number>`coalesce(sum(case when ${s.campaignRewards.participantId} = ${participantId} then ${s.campaignRewards.amountMicro} else 0 end), 0)::bigint`,
      campaign: sql<number>`coalesce(sum(${s.campaignRewards.amountMicro}), 0)::bigint`,
    })
    .from(s.campaignRewards)
    .where(and(eq(s.campaignRewards.campaignId, campaignId), isNull(s.campaignRewards.voidedAt)));
  return { creator: Number(r?.creator ?? 0), campaign: Number(r?.campaign ?? 0) };
}

/** Accrue one reward line, enforcing the creator and campaign ceilings. Idempotent per sourceKey: returns null if nothing new was credited. */
async function accrue(db: DB, c: Campaign, p: Participant, r: { kind: "post" | "discussion" | "action"; sourceKey: string; amountMicro: number; reason: string; evidence: Reward["evidence"]; postId?: string | null }): Promise<Reward | null> {
  const [dupe] = await db.select().from(s.campaignRewards).where(and(eq(s.campaignRewards.campaignId, c.id), eq(s.campaignRewards.sourceKey, r.sourceKey)));
  if (dupe && !dupe.voidedAt) return null; // already credited
  const totals = await earnedTotals(db, c.id, p.id);
  const ceiling = ceilingOf(c, p);
  // Only released budget can be earned; the held part waits for results-based release.
  const cap = capReward(r.amountMicro, { creatorEarnedMicro: totals.creator, creatorCapMicro: ceiling, campaignEarnedMicro: totals.campaign, budgetMicro: Math.min(c.budgetMicro, c.releasedMicro) });
  if (cap.amountMicro <= 0) return null;
  const reason = cap.capped ? `${r.reason} — reduced to ${fmtUsdc(cap.amountMicro)} by the ${cap.capped === "creator" ? `${fmtUsdc(ceiling)} ceiling for this creator` : "budget released so far"}` : r.reason;
  if (dupe) {
    const [row] = await db.update(s.campaignRewards).set({ amountMicro: cap.amountMicro, reason, evidence: r.evidence, voidedAt: null, voidReason: null, payoutId: null }).where(eq(s.campaignRewards.id, dupe.id)).returning();
    return row;
  }
  const [row] = await db
    .insert(s.campaignRewards)
    .values({ id: newId(), campaignId: c.id, participantId: p.id, postId: r.postId ?? null, kind: r.kind, sourceKey: r.sourceKey, amountMicro: cap.amountMicro, reason, evidence: r.evidence })
    .onConflictDoNothing({ target: [s.campaignRewards.campaignId, s.campaignRewards.sourceKey] })
    .returning();
  return row ?? null;
}

async function rewardIsPaidOrPaying(db: DB, rewardIds: string[]): Promise<boolean> {
  if (!rewardIds.length) return false;
  const rows = await db
    .select({ state: s.transactions.state })
    .from(s.campaignRewards)
    .innerJoin(s.campaignPayouts, eq(s.campaignRewards.payoutId, s.campaignPayouts.id))
    .innerJoin(s.transactions, eq(s.campaignPayouts.transactionId, s.transactions.id))
    .where(inArray(s.campaignRewards.id, rewardIds));
  return rows.some((r) => !RETURNED.includes(r.state));
}

/** Review a submitted post against the rubric. Accepting requires the paid relationship to be disclosed. */
export async function reviewPost(db: DB, a: { projectId: string; postId: string; accept: boolean; review: ReviewInput; userId: string }) {
  const [post] = await db.select().from(s.campaignPosts).where(eq(s.campaignPosts.id, a.postId));
  if (!post) throw new Error("Post not found");
  const c = await getCampaign(db, a.projectId, post.campaignId);
  if (!c) throw new Error("Post not found");
  const [p] = await db.select().from(s.campaignParticipants).where(eq(s.campaignParticipants.id, post.participantId));
  if (a.accept && !a.review.disclosure) throw new Error("A paid post must clearly disclose the relationship before it can be accepted");
  const existing = await db.select().from(s.campaignRewards).where(and(eq(s.campaignRewards.postId, post.id), isNull(s.campaignRewards.voidedAt)));
  if (await rewardIsPaidOrPaying(db, existing.map((r) => r.id))) throw new Error("Rewards for this post are already being paid — its review is locked");
  const review = {
    relevance: Math.min(5, Math.max(0, Math.round(a.review.relevance))),
    depth: Math.min(5, Math.max(0, Math.round(a.review.depth))),
    accuracy: Math.min(5, Math.max(0, Math.round(a.review.accuracy))),
    disclosure: !!a.review.disclosure,
    discussion: Math.min(3, Math.max(0, Math.round(a.review.discussion))),
    note: a.review.note.trim().slice(0, 500),
  };
  const score = qualityScore(review);
  await db.update(s.campaignPosts).set({ status: a.accept ? "accepted" : "rejected", review, qualityScore: score, reviewedBy: a.userId, reviewedAt: new Date() }).where(eq(s.campaignPosts.id, post.id));
  // Re-review replaces the previous outcome.
  if (existing.length) await db.update(s.campaignRewards).set({ voidedAt: new Date(), voidReason: "Post re-reviewed" }).where(inArray(s.campaignRewards.id, existing.map((r) => r.id)));
  const out: Reward[] = [];
  if (a.accept) {
    const accepted = await db.select({ id: s.campaignPosts.id }).from(s.campaignPosts).where(and(eq(s.campaignPosts.participantId, p.id), eq(s.campaignPosts.status, "accepted"))).orderBy(s.campaignPosts.submittedAt);
    const rank = accepted.findIndex((x) => x.id === post.id) + 1;
    const ev = { url: post.url, review: { ...review, qualityScore: score } };
    if (rank > 0 && rank <= c.maxPostsPerCreator) {
      const r = await accrue(db, c, p, { kind: "post", sourceKey: `post:${post.id}`, postId: post.id, amountMicro: c.basePayMicro, reason: `Accepted post ${rank} of ${c.maxPostsPerCreator} — quality ${score}/100, disclosure confirmed`, evidence: ev });
      if (r) out.push(r);
    }
    if (review.discussion > 0 && c.discussionBonusCapMicro > 0) {
      const amount = Math.floor((c.discussionBonusCapMicro * review.discussion) / 3 / 10_000) * 10_000;
      const r = await accrue(db, c, p, { kind: "discussion", sourceKey: `discussion:${post.id}`, postId: post.id, amountMicro: amount, reason: `Useful discussion rated ${review.discussion}/3${review.note ? ` — “${review.note.slice(0, 120)}”` : ""}`, evidence: ev });
      if (r) out.push(r);
    }
  }
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: a.accept ? "campaign.post_accept" : "campaign.post_reject", target: post.id, data: { score } });
  return { score, rewards: out };
}

/** Verified actions: target conversions carried by a creator's own tracking link, inside the window. */
export async function syncActionRewards(db: DB, c: Campaign): Promise<number> {
  if (c.actionBonusMicro <= 0) return 0;
  const parts = await db.select().from(s.campaignParticipants).where(and(eq(s.campaignParticipants.campaignId, c.id), eq(s.campaignParticipants.status, "accepted")));
  let added = 0;
  for (const p of parts) {
    if (!p.trackingCampaignId) continue;
    const [link] = await db.select({ code: s.campaigns.referralCode }).from(s.campaigns).where(eq(s.campaigns.id, p.trackingCampaignId));
    const events = await db
      .select()
      .from(s.conversionEvents)
      .where(
        and(
          eq(s.conversionEvents.campaignId, p.trackingCampaignId),
          eq(s.conversionEvents.eventType, c.targetEvent),
          gte(s.conversionEvents.occurredAt, c.startsAt),
          lte(s.conversionEvents.occurredAt, new Date(c.endsAt.getTime() + ATTRIBUTION_GRACE_DAYS * DAY_MS)),
          // A live campaign only pays for live events; demo events can't move money.
          c.dataMode === "DEMO" ? sql`true` : sql`${s.conversionEvents.dataMode} <> 'DEMO'`,
        ),
      )
      .orderBy(s.conversionEvents.occurredAt);
    for (const e of events) {
      // One reward per unique visitor, so one person repeating the action isn't paid twice.
      const key = `action:${e.visitorId ? `v:${e.visitorId}` : `e:${e.id}`}`;
      const [seen] = await db.select({ id: s.campaignRewards.id }).from(s.campaignRewards).where(and(eq(s.campaignRewards.campaignId, c.id), eq(s.campaignRewards.sourceKey, key), isNull(s.campaignRewards.voidedAt)));
      if (seen) continue;
      const r = await accrue(db, c, p, {
        kind: "action",
        sourceKey: key,
        amountMicro: c.actionBonusMicro,
        reason: `Verified ${EVENT_LABEL[e.eventType as ConversionEventType]?.toLowerCase() ?? e.eventType} via tracking link /r/${link?.code ?? "?"} (${relTime(e.occurredAt)})`,
        evidence: { eventId: e.id, eventType: e.eventType, occurredAt: e.occurredAt.toISOString() },
      });
      if (r) added++;
    }
  }
  return added;
}

export async function syncProjectCampaigns(db: DB, projectId: string): Promise<number> {
  const rows = await db.select().from(s.creatorCampaigns).where(eq(s.creatorCampaigns.projectId, projectId));
  let n = 0;
  for (const c of rows) if (c.status === "open" || Date.now() <= c.endsAt.getTime() + ATTRIBUTION_GRACE_DAYS * DAY_MS) n += await syncActionRewards(db, c);
  return n;
}

// ───────────────────────────── ledger ─────────────────────────────

export type RewardState = "holding" | "earned" | "in_payout" | "paid" | "simulated" | "void";

export interface LedgerLine extends Reward {
  state: RewardState;
  txState: string | null;
  txHash: string | null;
  explorerUrl: string | null;
}

export interface CreatorLedger {
  participant: Participant;
  ceilingMicro: number;
  /** Verified actions still inside the holdback period — earned, not yet payable. */
  holdingMicro: number;
  earnedMicro: number;
  inPayoutMicro: number;
  paidMicro: number;
  simulatedMicro: number;
  remainingCapMicro: number;
  acceptedPosts: number;
  actions: number;
  lines: LedgerLine[];
}

export interface CampaignLedger {
  budgetMicro: number;
  /** Released to creator ceilings so far (test phase + results-based releases). */
  releasedMicro: number;
  /** Not yet released — waits for creators whose measured cost per action beats the ceiling. */
  heldForResultsMicro: number;
  /** Verified actions inside the holdback period. Included in verifiedMicro. */
  holdingMicro: number;
  /** Paid out on-chain (submitted or settled). */
  paidMicro: number;
  /** Earned from verified results (accepted posts, rated discussion, attributed actions) and not yet paid. */
  verifiedMicro: number;
  /** Of which a payout is already in flight (awaiting approval or executing). */
  inPayoutMicro: number;
  simulatedMicro: number;
  /** Held for accepted creators up to their ceilings, not yet earned. */
  reservedMicro: number;
  /** Released but not committed to anyone. */
  availableMicro: number;
  creators: CreatorLedger[];
}

/** A verified action becomes payable only after the campaign's holdback period. */
export function inHoldback(c: Campaign, r: Pick<Reward, "kind" | "evidence" | "createdAt">, now = Date.now()): boolean {
  if (r.kind !== "action" || c.holdbackDays <= 0) return false;
  const at = r.evidence.occurredAt ? new Date(r.evidence.occurredAt).getTime() : r.createdAt.getTime();
  return at + c.holdbackDays * DAY_MS > now;
}

export async function campaignLedger(db: DB, c: Campaign): Promise<CampaignLedger> {
  const parts = await db.select().from(s.campaignParticipants).where(eq(s.campaignParticipants.campaignId, c.id)).orderBy(s.campaignParticipants.createdAt);
  const rows = await db
    .select({ r: s.campaignRewards, txState: s.transactions.state, txHash: s.transactions.txHash, explorerUrl: s.transactions.explorerUrl })
    .from(s.campaignRewards)
    .leftJoin(s.campaignPayouts, eq(s.campaignRewards.payoutId, s.campaignPayouts.id))
    .leftJoin(s.transactions, eq(s.campaignPayouts.transactionId, s.transactions.id))
    .where(eq(s.campaignRewards.campaignId, c.id))
    .orderBy(desc(s.campaignRewards.createdAt));
  const lines: LedgerLine[] = rows.map(({ r, txState, txHash, explorerUrl }) => ({
    ...r,
    txState: txState ?? null,
    txHash: txHash ?? null,
    explorerUrl: explorerUrl ?? null,
    state: r.voidedAt ? "void" : !txState || RETURNED.includes(txState) ? (inHoldback(c, r) ? "holding" : "earned") : PAID.includes(txState) ? "paid" : txState === "SIMULATED" ? "simulated" : IN_FLIGHT.includes(txState) ? "in_payout" : "earned",
  }));
  const posts = await db.select({ participantId: s.campaignPosts.participantId, status: s.campaignPosts.status }).from(s.campaignPosts).where(eq(s.campaignPosts.campaignId, c.id));
  const sum = (ls: LedgerLine[], st: RewardState) => ls.filter((l) => l.state === st).reduce((a, l) => a + l.amountMicro, 0);
  const creators: CreatorLedger[] = parts.map((p) => {
    const ls = lines.filter((l) => l.participantId === p.id);
    const live = ls.filter((l) => l.state !== "void");
    const total = live.reduce((a, l) => a + l.amountMicro, 0);
    return {
      participant: p,
      ceilingMicro: ceilingOf(c, p),
      holdingMicro: sum(ls, "holding"),
      earnedMicro: sum(ls, "earned"),
      inPayoutMicro: sum(ls, "in_payout"),
      paidMicro: sum(ls, "paid"),
      simulatedMicro: sum(ls, "simulated"),
      remainingCapMicro: p.status === "accepted" ? Math.max(0, ceilingOf(c, p) - total) : 0,
      acceptedPosts: posts.filter((x) => x.participantId === p.id && x.status === "accepted").length,
      actions: live.filter((l) => l.kind === "action").length,
      lines: ls,
    };
  });
  const paid = sum(lines, "paid");
  const holding = sum(lines, "holding");
  const earned = sum(lines, "earned");
  const inPayout = sum(lines, "in_payout");
  const simulated = sum(lines, "simulated");
  const allocated = paid + holding + earned + inPayout + simulated;
  const released = Math.min(c.budgetMicro, c.releasedMicro);
  const reserved = Math.min(Math.max(0, released - allocated), c.status === "open" ? creators.reduce((a, x) => a + x.remainingCapMicro, 0) : 0);
  return {
    budgetMicro: c.budgetMicro,
    releasedMicro: released,
    heldForResultsMicro: c.status === "open" ? Math.max(0, c.budgetMicro - released) : 0,
    holdingMicro: holding,
    paidMicro: paid,
    verifiedMicro: holding + earned + inPayout,
    inPayoutMicro: inPayout,
    simulatedMicro: simulated,
    reservedMicro: reserved,
    availableMicro: Math.max(0, released - allocated - reserved),
    creators,
  };
}

// ───────────────────────────── payouts ─────────────────────────────

/** Pay a creator everything they've earned and haven't been paid, through the policy engine. */
export async function proposePayout(db: DB, a: { projectId: string; campaignId: string; participantId: string; userId: string; runId?: string | null }): Promise<ProposalOutcome & { amountMicro: number }> {
  const c = await getCampaign(db, a.projectId, a.campaignId);
  if (!c) throw new Error("Campaign not found");
  const [p] = await db.select().from(s.campaignParticipants).where(and(eq(s.campaignParticipants.id, a.participantId), eq(s.campaignParticipants.campaignId, c.id)));
  if (!p) throw new Error("Creator not found");
  if (c.status === "open") await syncActionRewards(db, c);
  const ledger = await campaignLedger(db, c);
  const mine = ledger.creators.find((x) => x.participant.id === p.id);
  const eligible = (mine?.lines ?? []).filter((l) => l.state === "earned");
  const amount = eligible.reduce((x, l) => x + l.amountMicro, 0);
  if (amount <= 0) throw new Error(mine && mine.holdingMicro > 0 ? `Nothing payable yet — ${fmtUsdc(mine.holdingMicro)} is inside the ${c.holdbackDays}-day holdback` : "Nothing earned is waiting to be paid");
  const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, c.experimentId));
  const payoutId = newId();
  await db.insert(s.campaignPayouts).values({ id: payoutId, campaignId: c.id, participantId: p.id, amountMicro: amount, requestedBy: a.userId });
  const res = await proposeFinancialAction(db, {
    projectId: a.projectId,
    runId: a.runId,
    agent: "founder",
    title: `Creator payout — @${p.handle} (${c.name})`,
    input: {
      action: "send_payment",
      purpose: "kol_payment",
      recipient: p.payoutAddress,
      amount: microToDecimal(amount),
      currency: "USDC",
      chain: ARC.appKitChain,
      experimentId: c.experimentId,
      reasonCode: "PAY_CREATOR",
      payoutRef: `cp:${payoutId.replace(/-/g, "").slice(0, 24)}`,
      missionId: exp.missionId,
      confidence: 1,
      expectedValue: "high",
    },
    rationale: `Pays @${p.handle} for ${eligible.length} verified reward line${eligible.length === 1 ? "" : "s"} in creator campaign #${c.number}. Every line was earned under rules the creator accepted before posting.`,
    reasons: eligible.slice(0, 8).map((l) => `${fmtUsdc(l.amountMicro)} — ${l.reason}`),
    expectedOutcome: `@${p.handle} receives ${fmtUsdc(amount)} on ${ARC.name}`,
    evidence: eligible.filter((l) => l.evidence.url).slice(0, 5).map((l) => ({ url: l.evidence.url!, title: l.reason.slice(0, 80) })),
  });
  const [tx] = await db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.decisionId, res.decisionId));
  await db.update(s.campaignPayouts).set({ decisionId: res.decisionId, transactionId: tx?.id ?? null }).where(eq(s.campaignPayouts.id, payoutId));
  if (tx) await db.update(s.campaignRewards).set({ payoutId }).where(inArray(s.campaignRewards.id, eligible.map((l) => l.id)));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.payout", target: p.id, data: { amount, verdict: res.verdict, state: res.state } });
  return { ...res, amountMicro: amount };
}

// ───────────────────────────── observed mindshare ─────────────────────────────

export interface Mindshare {
  observedPosts: number;
  providers: string[];
  byParticipant: Record<string, { posts: number; share: number; engagement: number; engagementShare: number }>;
}

/**
 * OBSERVED mindshare: among topic posts GrowthOS collected from connected public sources during the
 * campaign window, the share authored by each creator. It is a sample — platforms don't expose every
 * post — so it is always shown with its sample size and sources.
 */
export async function observedMindshare(db: DB, c: Campaign, participants: Participant[]): Promise<Mindshare> {
  const terms = [c.topic, ...c.topicTerms].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  const posts = await db
    .select({ provider: s.socialPosts.provider, author: s.socialPosts.authorHandle, title: s.socialPosts.title, content: s.socialPosts.content, engagement: s.socialPosts.engagement })
    .from(s.socialPosts)
    .where(and(eq(s.socialPosts.projectId, c.projectId), gte(s.socialPosts.publishedAt, c.startsAt), lte(s.socialPosts.publishedAt, c.endsAt)))
    .limit(5000);
  const onTopic = posts.filter((p) => {
    const text = `${p.title ?? ""} ${p.content}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  });
  const eng = (e: typeof posts[number]["engagement"]) => (e?.comments ?? 0) * 3 + (e?.shares ?? 0) * 2 + (e?.likes ?? 0) + (e?.score ?? 0);
  const totalEng = onTopic.reduce((a, p) => a + eng(p.engagement), 0);
  const byParticipant: Mindshare["byParticipant"] = {};
  for (const part of participants) {
    const mine = onTopic.filter((p) => p.provider === part.provider && normalizeHandle(p.author) === part.handle);
    const e = mine.reduce((a, p) => a + eng(p.engagement), 0);
    byParticipant[part.id] = { posts: mine.length, share: onTopic.length ? mine.length / onTopic.length : 0, engagement: e, engagementShare: totalEng ? e / totalEng : 0 };
  }
  return { observedPosts: onTopic.length, providers: [...new Set(onTopic.map((p) => p.provider))], byParticipant };
}

export { PLATFORM_LABEL };

// ───────────────────────────── results-based release ─────────────────────────────

/**
 * Release held budget to creators whose measured cost per action beats the ceiling, in proportion
 * to their verified actions. Raises their ceilings; never pays anyone directly.
 */
export async function releaseHeldBudget(db: DB, a: { projectId: string; campaignId: string; userId: string }) {
  const c = await getCampaign(db, a.projectId, a.campaignId);
  if (!c) throw new Error("Campaign not found");
  if (c.status !== "open") throw new Error("The campaign is closed");
  await syncActionRewards(db, c);
  const ledger = await campaignLedger(db, c);
  const held = ledger.heldForResultsMicro;
  if (held <= 0) throw new Error("The whole budget is already released");
  const minActions = Number((c.plan as { rules?: { minActionsPerCreator?: number } }).rules?.minActionsPerCreator ?? 3);
  const accepted = ledger.creators.filter((x) => x.participant.status === "accepted");
  const { grants, skipped } = releaseToWinners({
    heldMicro: held,
    maxCostPerActionMicro: c.maxCostPerActionMicro,
    minActions,
    creators: accepted.map((x) => ({ id: x.participant.id, handle: x.participant.handle, earnedMicro: x.lines.filter((l) => l.state !== "void").reduce((s2, l) => s2 + l.amountMicro, 0), actions: x.actions })),
  });
  if (!grants.length) return { released: 0, grants, skipped };
  let released = 0;
  for (const g of grants) {
    const cur = accepted.find((x) => x.participant.id === g.id)!;
    await db.update(s.campaignParticipants).set({ ceilingMicro: cur.ceilingMicro + g.amountMicro }).where(eq(s.campaignParticipants.id, g.id));
    released += g.amountMicro;
  }
  await db.update(s.creatorCampaigns).set({ releasedMicro: c.releasedMicro + released, updatedAt: new Date() }).where(eq(s.creatorCampaigns.id, c.id));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "campaign.release", target: c.id, data: { released, grants, skipped } });
  return { released, grants, skipped };
}

/** Recent release decisions, newest first, from the audit log. */
export async function releaseHistory(db: DB, c: Campaign) {
  const rows = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.projectId, c.projectId), eq(s.auditLogs.action, "campaign.release"), eq(s.auditLogs.target, c.id))).orderBy(desc(s.auditLogs.at)).limit(20);
  return rows.map((r) => ({ at: r.at, data: r.data as { released: number; grants: { id: string; amountMicro: number; reason: string }[]; skipped: { id: string; reason: string }[] } }));
}
