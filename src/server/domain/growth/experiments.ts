import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { nextNumber } from "@/server/db/helpers";
import { newId, shortCode } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { experimentSpend, missionSpend } from "@/server/domain/agent/ledger";
import { proposeFinancialAction, type ProposalOutcome } from "@/server/domain/agent/execute";
import type { Logger } from "@/server/domain/intel/analyze";
import { utmSlug } from "@/server/domain/growth/attribution-links";
import { ARC } from "@/server/integrations/circle/config";

/**
 * STRATEGIST — turns an opportunity into a measurable experiment:
 * hypothesis, target, action, budget, timeframe, success metric, stop condition, evidence.
 * Templates are deterministic; numbers derive from the mission's planned cost per goal.
 */

export const DEMO_PAYOUT_FALLBACK = "0x000000000000000000000000000000000000dEaD";

export function payoutAddressFor(kolPayout?: string | null): string {
  return kolPayout ?? process.env.DEMO_PAYOUT_ADDRESS ?? process.env.SIGNALS_SELLER_ADDRESS ?? DEMO_PAYOUT_FALLBACK;
}

export async function createExperimentFromOpportunity(db: DB, p: { projectId: string; opportunityId: string; runId?: string | null; log?: Logger; budgetMicro?: number }) {
  const log = p.log ?? (() => {});
  const [opp] = await db.select().from(s.opportunities).where(eq(s.opportunities.id, p.opportunityId));
  if (!opp) throw new Error("opportunity not found");
  if (opp.type === "PRODUCT_ISSUE") throw new Error("Product issues are routed to the product team, not turned into paid experiments");
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, p.projectId), eq(s.missions.status, "active")));
  if (!mission) throw new Error("No active mission");
  const existing = await db.select().from(s.experiments).where(and(eq(s.experiments.opportunityId, opp.id), inArray(s.experiments.status, ["proposed", "awaiting_approval", "running"])));
  if (existing.length) return existing[0];
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, p.projectId));
  const kol = opp.kolId ? (await db.select().from(s.kols).where(eq(s.kols.id, opp.kolId)))[0] : undefined;
  const company = opp.companyId ? (await db.select().from(s.companies).where(eq(s.companies.id, opp.companyId)))[0] : undefined;
  const narrative = opp.narrativeId ? (await db.select().from(s.narratives).where(eq(s.narratives.id, opp.narrativeId)))[0] : undefined;

  const plannedCpa = Math.max(toMicro(1), Math.round(mission.budgetMicro / Math.max(1, mission.goalTarget)));
  const goalLabel = mission.goalEvent.replace(/_/g, " ");
  let t: { title: string; hypothesis: string; channel: string; category: string; action: string; budget: number; successEvent: string; days: number };
  switch (opp.type) {
    case "KOL":
      t = {
        title: `Technical creator campaign — @${kol?.handle}`,
        hypothesis: `A technical campaign by @${kol?.handle} around "${opp.title.split(" — ")[1] ?? "our category"}" will generate qualified developer traffic that converts to ${goalLabel}.`,
        channel: "kol",
        category: "kol",
        action: `Brief @${kol?.handle} with an evidence-backed angle; pay in two tranches (second only if the stop condition is not hit).`,
        budget: p.budgetMicro ?? Math.max(opp.estimatedCostMicro, toMicro(50)),
        successEvent: mission.goalEvent,
        days: 7,
      };
      break;
    case "NARRATIVE":
      t = {
        title: `Own the narrative — ${narrative?.label ?? opp.title}`,
        hypothesis: `Publishing the definitive technical piece on "${narrative?.label}" while it is ${narrative?.status.toLowerCase()} will capture developers searching for it.`,
        channel: "content",
        category: "content",
        action: "Commission one technical deep-dive + runnable demo from an independent technical writer; distribute in the threads where the narrative is active.",
        budget: p.budgetMicro ?? Math.max(opp.estimatedCostMicro, toMicro(25)),
        successEvent: mission.goalEvent,
        days: 10,
      };
      break;
    case "CUSTOMER":
      t = {
        title: `Personalized technical demo — ${company?.name}`,
        hypothesis: `A demo built for ${company?.name}'s announced use case will lead to a demo request within 7 days.`,
        channel: "content",
        category: "content",
        action: `Build a working integration against ${company?.name}'s stated stack; founder decides on outreach.`,
        budget: p.budgetMicro ?? toMicro(25),
        successEvent: "demo_request",
        days: 7,
      };
      break;
    default:
      t = {
        title: `Developer bounty — ${opp.title}`,
        hypothesis: "A small public bounty for a reference integration will produce reusable content and SDK activations.",
        channel: "bounty",
        category: "bounty",
        action: "Post a scoped bounty publicly; pay on merged PR.",
        budget: p.budgetMicro ?? toMicro(10),
        successEvent: mission.goalEvent,
        days: 7,
      };
  }
  // Never commit more than the mission has uncommitted: total − spent − pending − reserved by live experiments.
  const { spent, pending } = await missionSpend(db, mission.id);
  const live = await db.select().from(s.experiments).where(and(eq(s.experiments.missionId, mission.id), inArray(s.experiments.status, ["proposed", "awaiting_approval", "running"])));
  let reserved = 0;
  for (const x of live) reserved += Math.max(0, x.budgetMicro - (await experimentSpend(db, x.id)));
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
      target: t.successEvent === "demo_request" ? "1 demo request" : `${successTarget * 5} qualified developer visits`,
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
  const dest = project.website ?? project.docsUrl ?? "https://example.com";
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
    destinationUrl: dest,
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
export async function launchExperiment(db: DB, p: { projectId: string; experimentId: string; runId?: string | null; log?: Logger; tranche?: "first" | "second" }): Promise<ProposalOutcome> {
  const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, p.experimentId));
  if (!exp) throw new Error("experiment not found");
  const [campaign] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
  const kol = campaign?.kolId ? (await db.select().from(s.kols).where(eq(s.kols.id, campaign.kolId)))[0] : undefined;
  const [opp] = exp.opportunityId ? await db.select().from(s.opportunities).where(eq(s.opportunities.id, exp.opportunityId)) : [];
  const evidence = exp.evidenceIds.length ? await db.select().from(s.evidence).where(inArray(s.evidence.id, exp.evidenceIds)) : [];
  const amount = p.tranche === "second" ? exp.budgetMicro - exp.stopAfterSpendMicro : exp.stopAfterSpendMicro;
  const purpose = exp.channel === "kol" ? "kol_payment" : exp.channel === "bounty" ? "developer_bounty" : exp.channel === "community" ? "partner_incentive" : "campaign_payment";
  const res = await proposeFinancialAction(db, {
    projectId: p.projectId,
    runId: p.runId,
    agent: "operator",
    title: exp.channel === "kol" ? `KOL campaign — @${kol?.handle}` : exp.title,
    input: {
      action: "send_payment",
      purpose,
      recipient: payoutAddressFor(kol?.payoutAddress),
      amount: microToDecimal(amount),
      currency: "USDC",
      chain: ARC.appKitChain,
      experimentId: exp.id,
      reasonCode: exp.channel === "kol" ? "PAY_CREATOR" : exp.channel === "bounty" ? "PAY_BOUNTY" : "RUN_EXPERIMENT",
      expectedValue: opp?.expectedValue === "HIGH" ? "high" : opp?.expectedValue === "LOW" ? "low" : "medium",
      missionId: exp.missionId,
      confidence: opp?.confidence ?? 0.7,
    },
    rationale: `${p.tranche === "second" ? "Second" : "First"} tranche for experiment #${exp.number}: ${exp.hypothesis}`,
    reasons: [...(opp?.whyNow ?? []).slice(0, 3), `Stop condition: CPA > ${fmtUsdc(exp.stopMaxCpaMicro)} after ${fmtUsdc(exp.stopAfterSpendMicro)}`],
    expectedOutcome: `${exp.successTarget}+ ${exp.successEvent.replace(/_/g, " ")} (${exp.target})`,
    evidence: evidence.slice(0, 5).map((e) => ({ url: e.sourceUrl, title: e.sourceTitle ?? e.excerpt.slice(0, 80) })),
    log: p.log,
  });
  if (res.state === "AWAITING_APPROVAL") await db.update(s.experiments).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(s.experiments.id, exp.id));
  return res;
}
