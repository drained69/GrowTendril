import { randomBytes } from "node:crypto";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit, nextNumber } from "@/server/db/helpers";
import { newId, sha256, shortCode } from "@/server/lib/ids";
import { CampaignInput, ReviewInput, campaignEconomics, qualityScore, rewardFor, publicLink } from "@/lib/creator-campaigns";
import { experimentCommitted, isPayableAddress } from "@/server/domain/growth/experiments";
import { missionSpend, categorySpend, loadPolicy, SPENT_STATES, PENDING_STATES } from "@/server/domain/agent/ledger";
import { proposeFinancialAction } from "@/server/domain/agent/execute";
import { microToDecimal } from "@/lib/money";
import { notify } from "@/server/domain/notifications/webhooks";

const ACTIVE = ["proposed", "running", "awaiting_approval"];
async function locked<T>(db: DB, projectId: string, work: (db: DB) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${projectId}`}))`);
    return work(tx as unknown as DB);
  });
}
export async function programById(db: DB, projectId: string, id: string) {
  const [row] = await db.select({ program: s.creatorPrograms, experiment: s.experiments }).from(s.creatorPrograms)
    .innerJoin(s.experiments, eq(s.experiments.id, s.creatorPrograms.experimentId))
    .where(and(eq(s.creatorPrograms.id, id), eq(s.creatorPrograms.projectId, projectId)));
  if (!row) throw new Error("Campaign not found");
  return row;
}
function accepting(exp: typeof s.experiments.$inferSelect) {
  if (!ACTIVE.includes(exp.status) || !exp.endsAt || exp.endsAt <= new Date()) throw new Error("This campaign is no longer accepting participation or posts");
}

export async function createCreatorCampaign(db: DB, projectId: string, userId: string, input: unknown) {
  const v = CampaignInput.parse(input), economics = campaignEconomics(v);
  return locked(db, projectId, async db => {
    const policy = await loadPolicy(db, projectId);
    if (!Number.isSafeInteger(policy.hardCeilingMicro) || policy.hardCeilingMicro <= 0) throw new Error("Set a positive, safe per-payment ceiling before creating a creator campaign");
    if (economics.perCreator > policy.hardCeilingMicro) throw new Error(`Each creator's maximum reward exceeds your workspace per-payment ceiling of ${microToDecimal(policy.hardCeilingMicro)} USDC. Raise the ceiling in Settings or reduce the rewards.`);
    const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, projectId), eq(s.missions.status, "active")));
    if (!mission) throw new Error("Start a mission first so this campaign has a funded budget ceiling");
    const now = new Date(), endsAt = new Date(now.getTime() + 14 * 86400000);
    if (mission.endsAt < endsAt) throw new Error("The active mission must have at least 14 days remaining. Start a longer mission first.");
    const live = await db.select().from(s.experiments).where(and(eq(s.experiments.missionId, mission.id), inArray(s.experiments.status, ACTIVE)));
    const reservedByCategory: Record<string, number> = {};
    for (const e of live) reservedByCategory[e.budgetCategory] = (reservedByCategory[e.budgetCategory] ?? 0) + Math.max(0, e.budgetMicro - (await experimentCommitted(db, e.id)).committedMicro);
    const spend = await missionSpend(db, mission.id);
    if (economics.reserved > mission.budgetMicro - spend.spent - spend.pending - Object.values(reservedByCategory).reduce((a,b) => a+b, 0)) throw new Error("The mission has insufficient uncommitted budget for this creator pool");
    // Allocate to the actual creator commitments, preserving all existing spend and experiment reservations.
    const allocations = await db.select().from(s.missionBudgets).where(eq(s.missionBudgets.missionId, mission.id));
    const creator = allocations.find(a => a.category === "kol");
    const available = (creator?.allocatedMicro ?? 0) - await categorySpend(db, mission.id, "kol") - (reservedByCategory.kol ?? 0);
    let needed = Math.max(0, economics.reserved - available), moved = 0;
    for (const a of allocations.filter(a => a.category !== "kol")) {
      const free = Math.max(0, a.allocatedMicro - await categorySpend(db, mission.id, a.category) - (reservedByCategory[a.category] ?? 0));
      const take = Math.min(free, needed);
      if (take) await db.update(s.missionBudgets).set({ allocatedMicro: a.allocatedMicro - take, updatedAt: now }).where(eq(s.missionBudgets.id, a.id));
      moved += take; needed -= take;
    }
    if (needed) throw new Error("Existing category commitments leave too little budget for this campaign");
    if (creator) await db.update(s.missionBudgets).set({ allocatedMicro: creator.allocatedMicro + moved, updatedAt: now }).where(eq(s.missionBudgets.id, creator.id));
    else await db.insert(s.missionBudgets).values({ id: newId(), missionId: mission.id, category: "kol", allocatedMicro: moved });
    const experimentId = newId(), id = newId();
    await db.insert(s.experiments).values({ id: experimentId, projectId, missionId: mission.id, number: await nextNumber(db, "experiments", projectId),
      title: v.title, hypothesis: `Useful creator posts about ${v.topic} produce ${v.goal} at a target cost of ${microToDecimal(v.maxCpa)} USDC.`,
      channel: "creator_program", budgetCategory: "kol", target: `${v.target} ${v.goal}`, action: v.brief, budgetMicro: economics.reserved,
      successEvent: v.goal, successTarget: v.target, stopMaxCpaMicro: v.maxCpa, stopAfterSpendMicro: economics.reserved,
      timeframeDays: 14, startsAt: now, endsAt, status: "running", dataMode: "LIVE" });
    await db.insert(s.creatorPrograms).values({ id, projectId, experimentId, topic: v.topic, platform: v.platform, brief: v.brief,
      slots: v.slots, cashLimitMicro: v.cashLimit, baseMicro: v.base, qualityBonusMicro: v.qualityBonus, outcomeBonusMicro: v.outcomeBonus, outcomeCap: v.outcomeCap });
    await audit(db, { projectId, actorType: "user", actorId: userId, action: "creator_campaign.create", target: id, data: { ...economics, reallocatedMicro: moved, terms: v } });
    return id;
  });
}
export async function inviteCreator(db: DB, projectId: string, userId: string, programId: string, kolId: string) {
  return locked(db, projectId, async db => {
    const { program, experiment } = await programById(db, projectId, programId); accepting(experiment);
    const members = await db.select().from(s.creatorParticipants).where(eq(s.creatorParticipants.programId, programId));
    const existing = members.find(p => p.kolId === kolId);
    if (existing?.userId) throw new Error("This creator has already joined; their campaign is available in their creator portal");
    if (!existing && members.length >= program.slots) throw new Error("All creator slots are reserved");
    const [kol] = await db.select().from(s.kols).where(and(eq(s.kols.id, kolId), eq(s.kols.projectId, projectId), eq(s.kols.provider, program.platform), eq(s.kols.dataMode, "LIVE")));
    if (!kol) throw new Error("Choose a creator from this campaign's platform in this workspace");
    const token = randomBytes(32).toString("hex"), challenge = `growtendril-${shortCode(12)}`;
    if (existing) await db.update(s.creatorParticipants).set({ tokenHash: sha256(token), challenge }).where(eq(s.creatorParticipants.id, existing.id));
    else {
      const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
      const destinationUrl = publicLink(project.website || project.docsUrl || project.githubUrl || "");
      const campaignId = newId();
      await db.insert(s.campaigns).values({ id: campaignId, experimentId: experiment.id, kolId, name: `${experiment.title}: @${kol.handle}`, channel: program.platform,
        utmSource: program.platform, utmMedium: "creator", utmCampaign: programId, referralCode: shortCode(12), destinationUrl });
      await db.insert(s.creatorParticipants).values({ id: newId(), programId, kolId, campaignId, tokenHash: sha256(token), challenge });
    }
    await audit(db, { projectId, actorType: "user", actorId: userId, action: "creator_campaign.invite", target: programId, data: { kolId } });
    return token;
  });
}
export async function invitation(db: DB, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [r] = await db.select({ participant: s.creatorParticipants, program: s.creatorPrograms, experiment: s.experiments, creator: s.kols, campaign: s.campaigns })
    .from(s.creatorParticipants).innerJoin(s.creatorPrograms, eq(s.creatorPrograms.id, s.creatorParticipants.programId))
    .innerJoin(s.experiments, eq(s.experiments.id, s.creatorPrograms.experimentId)).innerJoin(s.kols, eq(s.kols.id, s.creatorParticipants.kolId))
    .innerJoin(s.campaigns, eq(s.campaigns.id, s.creatorParticipants.campaignId)).where(eq(s.creatorParticipants.tokenHash, sha256(token)));
  return r ?? null;
}
export async function acceptCreatorInvite(db: DB, userId: string, token: string, address: string, proofUrl: string) {
  const inv = await invitation(db, token); if (!inv) throw new Error("Invalid invitation");
  if (!isPayableAddress(address)) throw new Error("Enter a valid Arc USDC payout address");
  const proof = publicLink(proofUrl);
  return locked(db, inv.program.projectId, async db => {
    const fresh = (await invitation(db, token))!; accepting(fresh.experiment);
    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    if (!user?.emailVerifiedAt) throw new Error("Verify your email before accepting");
    if (fresh.participant.userId) throw new Error("This invitation has already been accepted");
    const [same] = await db.select().from(s.creatorParticipants).where(and(eq(s.creatorParticipants.programId, inv.program.id), eq(s.creatorParticipants.userId, userId)));
    if (same) throw new Error("One creator account can join each campaign once");
    await db.update(s.creatorParticipants).set({ userId, payoutAddress: address, proofUrl: proof, status: "accepted", acceptedAt: new Date() }).where(eq(s.creatorParticipants.id, fresh.participant.id));
    await audit(db, { projectId: inv.program.projectId, actorType: "user", actorId: userId, action: "creator_campaign.accept", target: fresh.participant.id, data: { to: address, proofUrl: proof } });
  });
}
export async function verifyParticipant(db: DB, projectId: string, userId: string, participantId: string) {
  return locked(db, projectId, async db => {
    const [p] = await db.select().from(s.creatorParticipants).where(eq(s.creatorParticipants.id, participantId));
    if (!p) throw new Error("Creator not found");
    const { experiment } = await programById(db, projectId, p.programId); accepting(experiment);
    if (p.status !== "accepted" || !p.proofUrl || !p.payoutAddress) throw new Error("The creator must accept and submit their ownership proof first");
    await db.update(s.creatorParticipants).set({ status: "verified", verifiedAt: new Date(), verifiedBy: userId }).where(eq(s.creatorParticipants.id, p.id));
    await audit(db, { projectId, actorType: "user", actorId: userId, action: "creator_campaign.verify", target: p.id, data: { proofUrl: p.proofUrl, challenge: p.challenge } });
  });
}
export async function submitContribution(db: DB, userId: string, participantId: string, url: string, publishedAt: Date) {
  const [p] = await db.select().from(s.creatorParticipants).where(and(eq(s.creatorParticipants.id, participantId), eq(s.creatorParticipants.userId, userId)));
  if (!p) throw new Error("Creator participation not found");
  const [program] = await db.select().from(s.creatorPrograms).where(eq(s.creatorPrograms.id, p.programId));
  return locked(db, program.projectId, async db => {
    const { experiment } = await programById(db, program.projectId, program.id); accepting(experiment);
    if (p.status !== "verified") throw new Error("The business must verify account ownership first");
    if (!Number.isFinite(publishedAt.getTime()) || publishedAt < p.acceptedAt! || publishedAt > new Date() || publishedAt > experiment.endsAt!) throw new Error("The post must be published after joining and within the campaign window");
    const postUrl = publicLink(url);
    const [existing] = await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.participantId, p.id));
    if (existing) throw new Error("One post per creator is eligible in this campaign; your post is already recorded");
    const [duplicate] = await db.select().from(s.creatorContributions).where(and(eq(s.creatorContributions.programId, program.id), eq(s.creatorContributions.postUrl, postUrl)));
    if (duplicate) throw new Error("This post has already been submitted");
    await db.insert(s.creatorContributions).values({ id: newId(), programId: program.id, participantId: p.id, postUrl, publishedAt });
    await audit(db, { projectId: program.projectId, actorType: "user", actorId: userId, action: "creator_campaign.submit", target: p.id, data: { postUrl } });
    await notify(db, program.projectId, { event: "creator.post_submitted", key: `creator.post_submitted:${p.id}`, summary: "A creator submitted a post for review", path: `/app/campaigns/${program.id}`, data: { program_id: program.id, participant_id: p.id, post_url: postUrl } });
  });
}
/** One signed, LIVE event per distinct visitor across the entire campaign. Manual events and visits earn no bonuses. */
export async function qualifiedOutcomes(db: DB, programId: string) {
  const [program] = await db.select().from(s.creatorPrograms).where(eq(s.creatorPrograms.id, programId));
  if (!program) return [];
  const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, program.experimentId));
  const rows = await db.select({ event: s.conversionEvents, participant: s.creatorParticipants.id, publishedAt: s.creatorContributions.publishedAt })
    .from(s.conversionEvents).innerJoin(s.creatorParticipants, eq(s.creatorParticipants.campaignId, s.conversionEvents.campaignId))
    .innerJoin(s.creatorContributions, eq(s.creatorContributions.participantId, s.creatorParticipants.id))
    .where(and(eq(s.creatorParticipants.programId, programId), eq(s.creatorParticipants.status, "verified"), eq(s.conversionEvents.projectId, program.projectId),
      eq(s.conversionEvents.source, "webhook"), eq(s.conversionEvents.dataMode, "LIVE"), eq(s.conversionEvents.eventType, exp.successEvent),
      gte(s.conversionEvents.occurredAt, exp.startsAt!), lte(s.conversionEvents.occurredAt, exp.endsAt!), lte(s.conversionEvents.createdAt, exp.endsAt!)))
    .orderBy(s.conversionEvents.occurredAt, s.conversionEvents.id);
  const seen = new Set<string>();
  return rows.filter(r => {
    const visitor = r.event.visitorId?.trim();
    if (!visitor || seen.has(visitor) || r.event.occurredAt < r.publishedAt || r.event.occurredAt > new Date()) return false;
    seen.add(visitor); return true;
  });
}
export async function reviewContribution(db: DB, projectId: string, userId: string, contributionId: string, input: unknown) {
  const v = ReviewInput.parse(input);
  return locked(db, projectId, async db => {
    const [c] = await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.id, contributionId));
    if (!c) throw new Error("Post not found");
    const { program, experiment } = await programById(db, projectId, c.programId);
    if (!ACTIVE.includes(experiment.status)) throw new Error("This campaign is closed");
    if (experiment.endsAt! > new Date()) throw new Error("Final reward review opens after the 14-day campaign so every creator gets the full outcome window");
    if (c.status !== "submitted") throw new Error("This review is already final");
    const score = qualityScore(v);
    if (v.decision === "accepted" && (v.relevance < 3 || v.originality < 3 || v.usefulness < 3)) throw new Error("Accepted posts need at least 3/5 for relevance, originality and usefulness");
    const outcomes = (await qualifiedOutcomes(db, program.id)).filter(r => r.participant === c.participantId);
    const rewardMicro = v.decision === "accepted" ? rewardFor(program, score, outcomes.length) : 0;
    await db.update(s.creatorContributions).set({ status: v.decision, review: v, score, rewardMicro, outcomeIds: outcomes.map(o => o.event.id), reviewedAt: new Date(), reviewedBy: userId }).where(eq(s.creatorContributions.id, c.id));
    await audit(db, { projectId, actorType: "user", actorId: userId, action: "creator_campaign.review", target: c.id, data: { ...v, score, rewardMicro } });
  });
}
export async function proposeCreatorReward(db: DB, projectId: string, contributionId: string) {
  return locked(db, projectId, async db => {
    const [c] = await db.select().from(s.creatorContributions).where(eq(s.creatorContributions.id, contributionId));
    if (!c) throw new Error("Post not found");
    const { program, experiment } = await programById(db, projectId, c.programId);
    const [p] = await db.select().from(s.creatorParticipants).where(eq(s.creatorParticipants.id, c.participantId));
    if (c.status !== "accepted" || !c.rewardMicro || p.status !== "verified") throw new Error("A verified creator and accepted post are required");
    const attempts = await db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.experimentId, experiment.id));
    return proposeFinancialAction(db, { projectId, input: { action: "send_payment", purpose: "kol_payment", recipient: p.payoutAddress,
      amount: microToDecimal(c.rewardMicro), currency: "USDC", chain: "Arc", experimentId: experiment.id, contributionId: c.id, installment: attempts.length + 1,
      reasonCode: "PAY_CREATOR", expectedValue: "medium", missionId: experiment.missionId, confidence: 1 },
      title: `Creator reward: ${experiment.title}`, rationale: `${c.score}/100 reviewed quality; ${c.outcomeIds.length} signed, distinct customer actions. ${String(c.review?.note ?? "")}`,
      reasons: ["Creator accepted published reward terms", "Account ownership manually verified", "One accepted post; final reward calculated from the published rubric"],
      evidence: [{ url: c.postUrl, title: "Accepted creator post" }], details: { creatorProgramId: program.id, contributionId: c.id, qualityScore: c.score, outcomeIds: c.outcomeIds } });
  });
}
export async function campaignParticipants(db: DB, programId: string) {
  return db.select({ participant: s.creatorParticipants, creator: s.kols, campaign: s.campaigns, contribution: s.creatorContributions })
    .from(s.creatorParticipants).innerJoin(s.kols, eq(s.kols.id, s.creatorParticipants.kolId)).innerJoin(s.campaigns, eq(s.campaigns.id, s.creatorParticipants.campaignId))
    .leftJoin(s.creatorContributions, eq(s.creatorContributions.participantId, s.creatorParticipants.id)).where(eq(s.creatorParticipants.programId, programId));
}
export async function campaignPayments(db: DB, experimentId: string) {
  return db.select({ transaction: s.transactions, action: s.agentDecisions.action }).from(s.transactions)
    .innerJoin(s.agentDecisions, eq(s.agentDecisions.id, s.transactions.decisionId)).where(eq(s.transactions.experimentId, experimentId));
}

/** Transparent sample statistic: distinct observed URLs with the literal topic phrase, capped at one per author/day. */
export async function observedMindshare(db: DB, projectId: string, program: typeof s.creatorPrograms.$inferSelect, exp: typeof s.experiments.$inferSelect) {
  const rows = await db.select({ handle: s.socialPosts.authorHandle, url: s.socialPosts.url, at: s.socialPosts.publishedAt }).from(s.socialPosts)
    .where(and(eq(s.socialPosts.projectId, projectId), eq(s.socialPosts.provider, program.platform), eq(s.socialPosts.dataMode, "LIVE"),
      gte(s.socialPosts.publishedAt, exp.startsAt!), lte(s.socialPosts.publishedAt, new Date(Math.min(Date.now(), exp.endsAt!.getTime()))),
      sql`position(${program.topic.toLowerCase()} in lower(coalesce(${s.socialPosts.title}, '') || ' ' || ${s.socialPosts.content})) > 0`))
    .orderBy(s.socialPosts.publishedAt);
  const urls = new Set<string>(), days = new Set<string>(), byCreator: Record<string, number> = {};
  for (const r of rows) {
    const handle = r.handle.toLowerCase().replace(/^@/, ""), day = `${handle}:${r.at.toISOString().slice(0,10)}`;
    if (urls.has(r.url) || days.has(day)) continue;
    urls.add(r.url); days.add(day); byCreator[handle] = (byCreator[handle] ?? 0) + 1;
  }
  return { observedPosts: rows.length, eligiblePosts: urls.size, authors: Object.keys(byCreator).length, byCreator };
}

export async function closeCreatorCampaign(db: DB, projectId: string, userId: string, programId: string) {
  return locked(db, projectId, async db => {
    const { program, experiment } = await programById(db, projectId, programId);
    if (!ACTIVE.includes(experiment.status)) throw new Error("This campaign is already closed");
    const members = await campaignParticipants(db, program.id);
    if (members.some(m => m.participant.userId) && experiment.endsAt! > new Date()) throw new Error("Joined creators keep their full 14-day submission window. Close after it ends.");
    if (members.some(m => m.contribution?.status === "submitted")) throw new Error("Review every submitted post before closing");
    const payments = await campaignPayments(db, experiment.id);
    if (payments.some(p => ["PROPOSED","AWAITING_APPROVAL","AUTHORIZED","EXECUTING","SUBMITTED"].includes(p.transaction.state))) throw new Error("Resolve all pending payments before closing");
    for (const m of members) {
      if (m.contribution?.status === "accepted" && !payments.some(p => p.action.contributionId === m.contribution!.id && p.transaction.state === "SETTLED")) throw new Error("Pay every accepted creator reward before releasing the unused pool");
    }
    await db.update(s.experiments).set({ status: "stopped", updatedAt: new Date(), outcome: { verdict: "CLOSED", reason: "All submitted work reviewed and all earned rewards settled" } }).where(eq(s.experiments.id, experiment.id));
    await audit(db, { projectId, actorType: "user", actorId: userId, action: "creator_campaign.close", target: programId });
  });
}
