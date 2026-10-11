import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { nextNumber } from "@/server/db/helpers";
import { newId, shortCode } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { recordDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { experimentSpend, missionSpend } from "@/server/domain/agent/ledger";
import { proposeFinancialAction, type ProposalOutcome } from "@/server/domain/agent/execute";
import { isBlockedRecipient } from "@/server/domain/agent/policy";
import type { Logger } from "@/server/domain/intel/analyze";
import { utmSlug } from "@/server/domain/growth/attribution-links";
import { missionPerformance } from "@/server/domain/growth/attribution";
import { cpa, type ExperimentPerformance } from "@/server/domain/growth/learning";
import { ARC, IS_MAINNET } from "@/server/integrations/circle/config";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";

/**
 * STRATEGIST — turns an opportunity into a measurable experiment:
 * hypothesis, target, action, budget, timeframe, success metric, stop condition, evidence.
 * Templates are deterministic; numbers derive from the mission's planned cost per goal.
 */

export const DEMO_PAYOUT_FALLBACK = "0x000000000000000000000000000000000000dEaD";

/**
 * Where a payment goes. The creator's own payout address always wins. A placeholder (DEMO_PAYOUT_ADDRESS,
 * the bundled seller, or the burn address) is allowed only when `placeholderOk` — the payment will be
 * SIMULATED in a DEMO workspace — so a real send can never reach it. Otherwise: null, nothing is proposed.
 */
export function payoutAddressFor(kolPayout: string | null | undefined, opts: { placeholderOk: boolean }): string | null {
  if (kolPayout && !isBlockedRecipient(kolPayout)) return kolPayout;
  if (!opts.placeholderOk) return null;
  return process.env.DEMO_PAYOUT_ADDRESS || process.env.SIGNALS_SELLER_ADDRESS || DEMO_PAYOUT_FALLBACK;
}

type Experiment = typeof s.experiments.$inferSelect;
type Tx = typeof s.transactions.$inferSelect;

/** The payee for an experiment's payments, or why there is none. */
export async function experimentPayee(db: DB, exp: Experiment) {
  const [campaign] = await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id));
  const kol = campaign?.kolId ? (await db.select().from(s.kols).where(eq(s.kols.id, campaign.kolId)))[0] : undefined;
  const [project] = await db.select({ dataMode: s.projects.dataMode }).from(s.projects).where(eq(s.projects.id, exp.projectId));
  const wallet = await getWallet(db, exp.projectId);
  // DEMO workspaces simulate (no live wallet); a testnet DEMO wallet may still use the configured demo payee.
  const placeholderOk = project?.dataMode === "DEMO" && (!walletIsLive(wallet) || !IS_MAINNET);
  const recipient = payoutAddressFor(kol?.payoutAddress, { placeholderOk });
  const placeholder = !!recipient && recipient !== kol?.payoutAddress;
  const reason = recipient
    ? null
    : kol
      ? `@${kol.handle} has no payout address — add one on the creator page before paying`
      : `No payee for this ${exp.channel} experiment — GrowthOS only pays to a creator's saved payout address`;
  return { kol, recipient, placeholder, reason };
}

const PAID: string[] = ["SUBMITTED", "SETTLED", "SIMULATED"];
const DEAD: string[] = ["DENIED", "REJECTED"];

/**
 * Tranche bookkeeping for an experiment: which payments are tranche 1 and 2 (by payoutRef; older
 * sends without one count in creation order), whether the stop condition has been hit, and whether
 * the second tranche may be released.
 */
export async function trancheState(db: DB, exp: Experiment) {
  const rows = await db
    .select({ tx: s.transactions, action: s.agentDecisions.action })
    .from(s.transactions)
    .innerJoin(s.agentDecisions, eq(s.transactions.decisionId, s.agentDecisions.id))
    .where(and(eq(s.transactions.experimentId, exp.id), eq(s.transactions.kind, "send")))
    .orderBy(asc(s.transactions.createdAt));
  const by: Record<1 | 2, Tx[]> = { 1: [], 2: [] };
  rows.forEach((r, i) => {
    const ref = (r.action as { payoutRef?: string }).payoutRef;
    by[ref === "tranche:2" || (!ref && i > 0) ? 2 : 1].push(r.tx);
  });
  const pick = (list: Tx[]) => [...list].reverse().find((t) => !DEAD.includes(t.state)) ?? list[list.length - 1] ?? null;
  const first = pick(by[1]);
  const second = pick(by[2]);

  const perf: ExperimentPerformance | undefined = (await missionPerformance(db, exp.missionId)).find((x) => x.experimentId === exp.id);
  const spent = perf?.spentMicro ?? 0;
  const c = perf ? cpa(perf.spentMicro, perf.conversions) : null;
  const stopHit = (exp.outcome as { verdict?: string } | null)?.verdict === "STOP" || (spent >= exp.stopAfterSpendMicro && (c == null || c > exp.stopMaxCpaMicro));
  const secondAmount = exp.budgetMicro - exp.stopAfterSpendMicro;
  const secondBlockedReason =
    exp.status !== "running"
      ? `Experiment is ${exp.status.replace(/_/g, " ")} — the second tranche is only released while it runs`
      : !first || !PAID.includes(first.state)
        ? "The first tranche has not been paid"
        : second && !DEAD.includes(second.state)
          ? `Second tranche already ${second.state.toLowerCase().replace(/_/g, " ")}`
          : stopHit
            ? `Stop condition hit: CPA ${c == null ? "∞ (no conversions)" : fmtUsdc(c)} > ${fmtUsdc(exp.stopMaxCpaMicro)} after ${fmtUsdc(spent)} — second tranche withheld`
            : secondAmount <= 0
              ? "No budget left for a second tranche"
              : null;
  return { first, second, perf, cpaMicro: c, stopHit, secondAmountMicro: secondAmount, canReleaseSecond: !secondBlockedReason, secondBlockedReason };
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
  if (kol) await db.update(s.kols).set({ status: "engaged", updatedAt: new Date() }).where(eq(s.kols.id, kol.id));

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

/**
 * Launch: pay the first tranche (stopAfterSpend) through the policy engine; later, the second tranche
 * (the rest of the budget) only while running, after tranche 1 is paid and the stop condition is not hit.
 * Nothing is proposed — and no decision recorded — when there is no valid payee.
 */
export type LaunchOutcome = Omit<ProposalOutcome, "decisionId"> & { decisionId: string | null };

export async function launchExperiment(db: DB, p: { projectId: string; experimentId: string; runId?: string | null; log?: Logger; tranche?: "first" | "second" }): Promise<LaunchOutcome> {
  const log = p.log ?? (() => {});
  const [exp] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, p.experimentId), eq(s.experiments.projectId, p.projectId)));
  if (!exp) throw new Error("experiment not found");
  const second = p.tranche === "second";
  const blocked = (state: string, message: string): LaunchOutcome => {
    log("operator", `Experiment #${exp.number}: ${message}`);
    return { decisionId: null, verdict: "NOT_PROPOSED", state, message };
  };
  if (second) {
    const ts = await trancheState(db, exp);
    if (ts.secondBlockedReason) return blocked("BLOCKED", ts.secondBlockedReason);
  } else if (exp.status !== "proposed") return blocked("BLOCKED", `Experiment is ${exp.status.replace(/_/g, " ")} — only a proposed experiment can be launched`);

  const payee = await experimentPayee(db, exp);
  if (!payee.recipient) return blocked("NO_RECIPIENT", payee.reason!);
  const kol = payee.kol;
  const [opp] = exp.opportunityId ? await db.select().from(s.opportunities).where(eq(s.opportunities.id, exp.opportunityId)) : [];
  const evidence = exp.evidenceIds.length ? await db.select().from(s.evidence).where(inArray(s.evidence.id, exp.evidenceIds)) : [];
  const amount = second ? exp.budgetMicro - exp.stopAfterSpendMicro : exp.stopAfterSpendMicro;
  const purpose = exp.channel === "kol" ? "kol_payment" : exp.channel === "bounty" ? "developer_bounty" : exp.channel === "community" ? "partner_incentive" : "campaign_payment";
  const res = await proposeFinancialAction(db, {
    projectId: p.projectId,
    runId: p.runId,
    agent: "operator",
    title: `${exp.channel === "kol" ? `KOL campaign — @${kol?.handle}` : exp.title}${second ? " (tranche 2)" : ""}`,
    input: {
      action: "send_payment",
      purpose,
      recipient: payee.recipient,
      amount: microToDecimal(amount),
      currency: "USDC",
      chain: ARC.appKitChain,
      experimentId: exp.id,
      payoutRef: second ? "tranche:2" : "tranche:1",
      reasonCode: exp.channel === "kol" ? "PAY_CREATOR" : exp.channel === "bounty" ? "PAY_BOUNTY" : "RUN_EXPERIMENT",
      expectedValue: opp?.expectedValue === "HIGH" ? "high" : opp?.expectedValue === "LOW" ? "low" : "medium",
      missionId: exp.missionId,
      confidence: opp?.confidence ?? 0.7,
    },
    rationale: `${second ? "Second" : "First"} tranche for experiment #${exp.number}: ${exp.hypothesis}`,
    reasons: [...(opp?.whyNow ?? []).slice(0, 3), `Stop condition: CPA > ${fmtUsdc(exp.stopMaxCpaMicro)} after ${fmtUsdc(exp.stopAfterSpendMicro)}`, ...(payee.placeholder ? ["DEMO placeholder payee — the payment is simulated"] : [])],
    expectedOutcome: `${exp.successTarget}+ ${exp.successEvent.replace(/_/g, " ")} (${exp.target})`,
    evidence: evidence.slice(0, 5).map((e) => ({ url: e.sourceUrl, title: e.sourceTitle ?? e.excerpt.slice(0, 80) })),
    log: p.log,
  });
  // A running experiment stays running while its second tranche waits for approval.
  if (!second && res.state === "AWAITING_APPROVAL") await db.update(s.experiments).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(s.experiments.id, exp.id));
  return res;
}
