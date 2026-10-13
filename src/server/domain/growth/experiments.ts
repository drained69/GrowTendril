import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit, nextNumber } from "@/server/db/helpers";
import { newId, shortCode } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { experimentSpend, loadPolicy, missionSpend, PENDING_STATES, SPENT_STATES } from "@/server/domain/agent/ledger";
import { proposeFinancialAction, type ProposalOutcome } from "@/server/domain/agent/execute";
import type { Logger } from "@/server/domain/intel/analyze";
import { utmSlug } from "@/server/domain/growth/attribution-links";
import { ARC } from "@/server/integrations/circle/config";

/**
 * STRATEGIST — turns an opportunity into a measurable experiment:
 * hypothesis, target, action, budget, timeframe, success metric, stop condition, evidence.
 * Templates are deterministic; numbers derive from the mission's planned cost per goal.
 */

export const isPayableAddress = (a?: string | null): a is string => !!a && /^0x[a-fA-F0-9]{40}$/.test(a) && !/^0x0{40}$/i.test(a) && !/^0x0{36}dead$/i.test(a);

export function payoutAddressFor(kolPayout?: string | null): string {
  if (!isPayableAddress(kolPayout)) throw new Error("A valid creator payout address is required before proposing a payment");
  return kolPayout;
}

/** Who an experiment pays: the creator for a creator campaign, otherwise the recipient the founder set. */
export function experimentRecipient(exp: { recipientAddress: string | null }, kol?: { handle: string; payoutAddress: string | null } | null): string {
  if (kol) {
    if (!isPayableAddress(kol.payoutAddress)) throw new Error(`Add @${kol.handle}'s USDC payout address on their creator page before paying them`);
    return kol.payoutAddress;
  }
  if (!isPayableAddress(exp.recipientAddress)) throw new Error("Add who gets paid (a USDC address on Arc) before launching — or run it yourself without paying");
  return exp.recipientAddress;
}

export async function createExperimentFromOpportunity(db: DB, p: { projectId: string; opportunityId: string; runId?: string | null; log?: Logger; budgetMicro?: number }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${p.projectId}`}))`);
    return createExperimentLocked(tx as unknown as DB, p);
  });
}

async function createExperimentLocked(db: DB, p: Parameters<typeof createExperimentFromOpportunity>[1]) {
  const log = p.log ?? (() => {});
  const [opp] = await db.select().from(s.opportunities).where(and(eq(s.opportunities.id, p.opportunityId), eq(s.opportunities.projectId, p.projectId)));
  if (!opp) throw new Error("opportunity not found");
  if (opp.type === "PRODUCT_ISSUE") throw new Error("Product issues are routed to the product team, not turned into paid experiments");
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, p.projectId), eq(s.missions.status, "active")));
  if (!mission) throw new Error("No active mission");
  if (p.budgetMicro !== undefined && (!Number.isSafeInteger(p.budgetMicro) || p.budgetMicro < toMicro(5))) throw new Error("Experiment budget must be at least 5 USDC in whole micro-USDC units");
  const existing = await db.select().from(s.experiments).where(and(eq(s.experiments.opportunityId, opp.id), inArray(s.experiments.status, ["proposed", "awaiting_approval", "running"])));
  if (existing.length) return existing[0];
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, p.projectId));
  // Where tracked links send people. No link at all is fine: the campaign still gets a referral
  // code customers can quote (by phone, in person), recorded by hand on the experiment page.
  const destinationUrl = project?.website || project?.docsUrl || project?.githubUrl || (project?.xHandle ? `https://x.com/${project.xHandle.replace(/^@/, "")}` : "");
  if (!destinationUrl) log("strategist", "No website yet — this experiment will track results by referral code only");
  const kol = opp.kolId ? (await db.select().from(s.kols).where(eq(s.kols.id, opp.kolId)))[0] : undefined;
  const company = opp.companyId ? (await db.select().from(s.companies).where(eq(s.companies.id, opp.companyId)))[0] : undefined;
  const narrative = opp.narrativeId ? (await db.select().from(s.narratives).where(eq(s.narratives.id, opp.narrativeId)))[0] : undefined;

  const plannedCpa = Math.max(toMicro(1), Math.round(mission.budgetMicro / Math.max(1, mission.goalTarget)));
  const goalLabel = mission.goalEvent.replace(/_/g, " ");
  const [profile] = await db.select({ audience: s.productProfiles.audience }).from(s.productProfiles).where(eq(s.productProfiles.projectId, p.projectId));
  const dev = profile?.audience === "developers";
  const visitors = dev ? "developer visits" : "visits";
  let t: { title: string; hypothesis: string; channel: string; category: string; action: string; budget: number; successEvent: string; days: number };
  switch (opp.type) {
    case "KOL":
      t = {
        title: `Creator campaign — @${kol?.handle}`,
        hypothesis: `A campaign by @${kol?.handle} around "${opp.title.split(" — ")[1] ?? "our category"}" will bring qualified ${visitors} that convert to ${goalLabel}.`,
        channel: "kol",
        category: "kol",
        action: `Brief @${kol?.handle} with an evidence-backed angle; pay in two tranches (second once the post is live and recorded, and only if the stop condition is not hit).`,
        budget: p.budgetMicro ?? Math.max(opp.estimatedCostMicro, toMicro(50)),
        successEvent: mission.goalEvent,
        days: 7,
      };
      break;
    case "NARRATIVE":
      t = {
        title: `Own the conversation — ${narrative?.label ?? opp.title}`,
        hypothesis: `Publishing the definitive piece on "${narrative?.label}" while it is ${narrative?.status.toLowerCase()} will reach people already searching for it.`,
        channel: "content",
        category: "content",
        action: dev
          ? "Commission one technical deep-dive + runnable demo from an independent technical writer; distribute in the threads where the conversation is active."
          : "Commission one definitive guide, video or post from an independent creator; share it where the conversation is active.",
        budget: p.budgetMicro ?? Math.max(opp.estimatedCostMicro, toMicro(25)),
        successEvent: mission.goalEvent,
        days: 10,
      };
      break;
    case "CUSTOMER":
      t = {
        title: `Tailored pitch — ${company?.name}`,
        hypothesis: `A demo or proposal built around ${company?.name}'s stated need will lead to a demo or quote request within 7 days.`,
        channel: "content",
        category: "content",
        action: dev ? `Build a working integration against ${company?.name}'s stated stack; founder decides on outreach.` : `Prepare a tailored demo, sample or proposal for ${company?.name}'s stated need; founder decides on outreach.`,
        budget: p.budgetMicro ?? toMicro(25),
        successEvent: "demo_request",
        days: 7,
      };
      break;
    default:
      t = {
        title: `${dev ? "Developer" : "Community"} bounty — ${opp.title}`,
        hypothesis: dev ? "A small public bounty for a reference integration will produce reusable content and activations." : "A small public bounty for a useful piece of content or a referral will produce reusable material and signups.",
        channel: "bounty",
        category: "bounty",
        action: dev ? "Post a scoped bounty publicly; pay on merged PR." : "Post a scoped bounty publicly; pay on an accepted deliverable.",
        budget: p.budgetMicro ?? toMicro(10),
        successEvent: mission.goalEvent,
        days: 7,
      };
  }
  // Never commit more than the mission has uncommitted: total − spent − pending − reserved by live experiments.
  const { spent, pending } = await missionSpend(db, mission.id);
  const live = await db.select().from(s.experiments).where(and(eq(s.experiments.missionId, mission.id), inArray(s.experiments.status, ["proposed", "awaiting_approval", "running"])));
  let reserved = 0;
  for (const x of live) reserved += Math.max(0, x.budgetMicro - (await experimentCommitted(db, x.id)).committedMicro);
  const uncommitted = mission.budgetMicro - spent - pending - reserved;
  if (uncommitted < toMicro(5)) throw new Error(`Only ${fmtUsdc(Math.max(0, uncommitted))} of the mission budget is uncommitted — stop or finish an experiment first`);
  if (t.budget > uncommitted) {
    log("strategist", `Budget trimmed from ${fmtUsdc(t.budget)} to the ${fmtUsdc(uncommitted)} still uncommitted`);
    t.budget = Math.floor(uncommitted / 10_000) * 10_000;
  }
  const successTarget = t.successEvent === "demo_request" ? 1 : Math.max(2, Math.ceil(t.budget / (plannedCpa * 6)));
  const stopMaxCpa = t.successEvent === "demo_request" ? t.budget : plannedCpa * 6;
  const number = await nextNumber(db, "experiments", p.projectId);
  const evidenceRows = await db
    .select({ id: s.evidence.id })
    .from(s.evidence)
    .where(opp.companyId ? eq(s.evidence.companyId, opp.companyId) : opp.kolId ? eq(s.evidence.kolId, opp.kolId) : opp.narrativeId ? eq(s.evidence.narrativeId, opp.narrativeId) : eq(s.evidence.id, "none"));

  const [exp] = await db
    .insert(s.experiments)
    .values({
      id: newId(),
      projectId: p.projectId,
      missionId: mission.id,
      opportunityId: opp.id,
      number,
      title: t.title,
      hypothesis: t.hypothesis,
      channel: t.channel,
      budgetCategory: t.category,
      target: t.successEvent === "demo_request" ? "1 demo or quote request" : `${successTarget * 5} qualified ${visitors}`,
      action: t.action,
      budgetMicro: t.budget,
      successEvent: t.successEvent,
      successTarget,
      stopMaxCpaMicro: stopMaxCpa,
      stopAfterSpendMicro: Math.round(t.budget / 2),
      timeframeDays: t.days,
      status: "proposed",
      evidenceIds: evidenceRows.map((e) => e.id).slice(0, 10),
      dataMode: opp.dataMode,
    })
    .returning();

  const code = shortCode(8);
  await db.insert(s.campaigns).values({
    id: newId(),
    experimentId: exp.id,
    kolId: kol?.id ?? null,
    name: exp.title,
    channel: t.channel,
    utmSource: kol ? utmSlug(`${kol.provider}_${kol.handle}`) : t.channel,
    utmMedium: t.channel === "kol" ? "creator" : t.channel,
    utmCampaign: utmSlug(`exp${number}_${mission.template}`),
    referralCode: code,
    destinationUrl,
  });
  await db.update(s.opportunities).set({ status: "experiment", updatedAt: new Date() }).where(eq(s.opportunities.id, opp.id));

  const d = await recordDecision(db, {
    projectId: p.projectId,
    missionId: mission.id,
    runId: p.runId,
    agent: "strategist",
    kind: "create_experiment",
    action: { action: "create_experiment", opportunityId: opp.id, experimentId: exp.id, budgetMicro: t.budget },
    rationale: `Opportunity #${opp.number} reached ${(opp.confidence * 100).toFixed(0)}% confidence with ${opp.expectedValue} expected value. Converted into experiment #${number} with a stop condition so no more than ${fmtUsdc(exp.stopAfterSpendMicro)} is at risk before evidence comes in.`,
    inputs: { confidenceBefore: opp.confidence, reasons: opp.whyNow },
    status: "executed",
    dataMode: opp.dataMode,
  });
  await writeReceipt(db, d.id);
  log("strategist", `Experiment #${number}: ${t.title} — budget ${fmtUsdc(t.budget)}, success ${successTarget} × ${t.successEvent}, stop if CPA > ${fmtUsdc(stopMaxCpa)} after ${fmtUsdc(exp.stopAfterSpendMicro)}`);
  return exp;
}

/** Launch: pay the first tranche (50% of budget) through the policy engine. */
/** What an experiment has paid or committed so far (settled, in flight, or waiting for approval). */
export async function experimentCommitted(db: DB, experimentId: string): Promise<{ committedMicro: number; attempts: number }> {
  const txs = await db.select({ amount: s.transactions.amountMicro, state: s.transactions.state }).from(s.transactions).where(eq(s.transactions.experimentId, experimentId));
  const live = new Set<string>([...SPENT_STATES, ...PENDING_STATES, "PROPOSED"]);
  return { committedMicro: txs.filter((t) => live.has(t.state)).reduce((n, t) => n + t.amount, 0), attempts: txs.length };
}

export async function nextInstallment(db: DB, exp: { id: string; budgetMicro: number; stopAfterSpendMicro: number }, tranche: "first" | "second", ceilingMicro: number) {
  const { committedMicro, attempts } = await experimentCommitted(db, exp.id);
  const end = tranche === "second" ? exp.budgetMicro : Math.min(exp.stopAfterSpendMicro, exp.budgetMicro);
  const due = end - committedMicro;
  if (due <= 0) throw new Error(tranche === "first" ? "The first tranche is already paid or waiting for approval. Release the second tranche once results justify it." : "This experiment's whole budget is already paid or waiting for approval.");
  return { amount: Math.min(due, ceilingMicro), installment: attempts + 1, dueMicro: due };
}

/**
 * The second tranche pays on delivery: someone records where the paid work lives (the post,
 * article or merged PR) first. The approver then sees the order (this experiment and who it
 * pays), the delivery, and the tracked traffic since the first payment side by side.
 */
export async function recordDelivery(db: DB, v: { projectId: string; experimentId: string; userId: string; url: string; note?: string | null }) {
  const [exp] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, v.experimentId), eq(s.experiments.projectId, v.projectId)));
  if (!exp) throw new Error("experiment not found");
  if (exp.status !== "running") throw new Error(exp.status === "proposed" || exp.status === "awaiting_approval" ? "Record delivery once the experiment is running." : `This experiment is ${exp.status}.`);
  let url: URL;
  try {
    url = new URL(v.url.trim());
  } catch {
    throw new Error("Paste the full link to the delivered work, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Paste the full link to the delivered work, starting with https://");
  const note = v.note?.trim().slice(0, 300) || null;
  await db.update(s.experiments).set({ deliveryUrl: url.toString(), deliveryNote: note, deliveredAt: new Date(), deliveredBy: v.userId, updatedAt: new Date() }).where(eq(s.experiments.id, exp.id));
  await audit(db, { projectId: v.projectId, actorType: "user", actorId: v.userId, action: "experiment.delivery", target: exp.id, data: { from: exp.deliveryUrl, to: url.toString(), note } });
}

/** What the approver of a payment on delivery sees: the delivered work and the traffic since tranche 1 went out. */
export async function deliveryEvidence(db: DB, exp: typeof s.experiments.$inferSelect) {
  if (!exp.deliveryUrl || !exp.deliveredAt) return null;
  const [first] = await db
    .select({ at: sql<Date | null>`min(${s.transactions.createdAt})` })
    .from(s.transactions)
    .where(and(eq(s.transactions.experimentId, exp.id), inArray(s.transactions.state, ["SETTLED", "SUBMITTED"])));
  const since = first?.at ? new Date(first.at) : exp.startsAt ?? exp.createdAt;
  const rows = await db
    .select({ type: s.conversionEvents.eventType, n: sql<number>`count(*)::int` })
    .from(s.attribution)
    .innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id))
    .where(and(eq(s.attribution.experimentId, exp.id), gte(s.conversionEvents.occurredAt, since)))
    .groupBy(s.conversionEvents.eventType);
  const [by] = exp.deliveredBy ? await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, exp.deliveredBy)) : [];
  return {
    url: exp.deliveryUrl,
    note: exp.deliveryNote,
    recordedAt: exp.deliveredAt.toISOString(),
    recordedBy: by?.name ?? null,
    since: since.toISOString(),
    visits: rows.find((r) => r.type === "visit")?.n ?? 0,
    conversions: rows.find((r) => r.type === exp.successEvent)?.n ?? 0,
    successEvent: exp.successEvent,
  };
}

export async function launchExperiment(db: DB, p: { projectId: string; experimentId: string; runId?: string | null; log?: Logger; tranche?: "first" | "second" }): Promise<ProposalOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${p.projectId}`}))`);
    return launchExperimentLocked(tx as unknown as DB, p);
  });
}

async function launchExperimentLocked(db: DB, p: Parameters<typeof launchExperiment>[1]): Promise<ProposalOutcome> {
  const [exp] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, p.experimentId), eq(s.experiments.projectId, p.projectId)));
  if (!exp) throw new Error("experiment not found");
  if (exp.channel === "creator_program") throw new Error("Review and pay individual posts from Creator campaigns");
  if (!["proposed", "awaiting_approval", "running"].includes(exp.status)) throw new Error(`This experiment is ${exp.status}; it cannot receive another payment`);
  // Tranche 2 pays on delivery.
  const delivery = p.tranche === "second" ? await deliveryEvidence(db, exp) : null;
  if (p.tranche === "second" && !delivery) throw new Error("Tranche 2 pays on delivery. Record the link to the delivered work (the post, article or merged PR) on this experiment first.");
  const [campaign] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
  const kol = campaign?.kolId ? (await db.select().from(s.kols).where(eq(s.kols.id, campaign.kolId)))[0] : undefined;
  const [opp] = exp.opportunityId ? await db.select().from(s.opportunities).where(eq(s.opportunities.id, exp.opportunityId)) : [];
  const evidence = exp.evidenceIds.length ? await db.select().from(s.evidence).where(inArray(s.evidence.id, exp.evidenceIds)) : [];
  // Each tranche is paid in installments no larger than the per-payment ceiling, counting what is
  // already paid or waiting for approval, so a 15 USDC tranche under a 10 USDC ceiling is 10 + 5.
  const { amount, installment } = await nextInstallment(db, exp, p.tranche ?? "first", (await loadPolicy(db, p.projectId)).hardCeilingMicro);
  const purpose = exp.channel === "kol" ? "kol_payment" : exp.channel === "bounty" ? "developer_bounty" : exp.channel === "community" ? "partner_incentive" : "campaign_payment";
  const res = await proposeFinancialAction(db, {
    projectId: p.projectId,
    runId: p.runId,
    agent: "operator",
    title: exp.channel === "kol" ? `KOL campaign — @${kol?.handle}` : exp.title,
    input: {
      action: "send_payment",
      purpose,
      recipient: experimentRecipient(exp, kol ?? null),
      amount: microToDecimal(amount),
      currency: "USDC",
      chain: ARC.appKitChain,
      experimentId: exp.id,
      installment,
      reasonCode: exp.channel === "kol" ? "PAY_CREATOR" : exp.channel === "bounty" ? "PAY_BOUNTY" : "RUN_EXPERIMENT",
      expectedValue: opp?.expectedValue === "HIGH" ? "high" : opp?.expectedValue === "LOW" ? "low" : "medium",
      missionId: exp.missionId,
      confidence: opp?.confidence ?? 0.7,
    },
    rationale: `${p.tranche === "second" ? "Second" : "First"} tranche for experiment #${exp.number}: ${exp.hypothesis}`,
    reasons: [
      ...(delivery ? [`Delivered: ${delivery.url} — ${delivery.visits} tracked visit${delivery.visits === 1 ? "" : "s"} and ${delivery.conversions} ${delivery.successEvent.replace(/_/g, " ")} event${delivery.conversions === 1 ? "" : "s"} since tranche 1`] : []),
      ...(opp?.whyNow ?? []).slice(0, 3),
      `Stop condition: CPA > ${fmtUsdc(exp.stopMaxCpaMicro)} after ${fmtUsdc(exp.stopAfterSpendMicro)}`,
    ],
    details: { tranche: p.tranche ?? "first", delivery },
    expectedOutcome: `${exp.successTarget}+ ${exp.successEvent.replace(/_/g, " ")} (${exp.target})`,
    evidence: evidence.slice(0, 5).map((e) => ({ url: e.sourceUrl, title: e.sourceTitle ?? e.excerpt.slice(0, 80) })),
    log: p.log,
  });
  if (res.state === "AWAITING_APPROVAL") await db.update(s.experiments).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(s.experiments.id, exp.id));
  return res;
}
