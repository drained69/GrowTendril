"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toMicro } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { PLATFORMS, planCampaign, type CampaignPlan } from "@/server/domain/growth/campaign-plan";
import { closeCampaign, createCampaign, decideParticipant, getCampaign, joinCampaign, proposePayout, releaseHeldBudget, reviewPost, submitPost, syncActionRewards } from "@/server/domain/growth/creator-campaigns";
import { getEconomics, measureEconomics, planRules, suggestCeiling, type CeilingSuggestion, type Measured } from "@/server/domain/growth/economics";
import { audit } from "@/server/db/helpers";
import { schema as s } from "@/server/db/client";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

const usdc = z.string().trim().regex(/^\d{1,7}(\.\d{1,6})?$/, "Enter a USDC amount like 25 or 2.5");

const CampaignForm = z.object({
  name: z.string().trim().min(3, "Name the campaign").max(80),
  topic: z.string().trim().min(2, "What should creators talk about?").max(60),
  topicTerms: z.string().max(300).default(""),
  brief: z.string().trim().min(20, "Give creators a short brief (20+ characters)").max(2000),
  destinationUrl: z.string().trim().url("Destination must be a full URL").refine((u) => u.startsWith("https://"), "Destination must use https"),
  targetEvent: z.enum(CONVERSION_EVENTS).refine((e) => e !== "visit", "Pick an action beyond a visit — visits are cheap to fake"),
  maxCpa: usdc,
  budget: usdc,
  days: z.coerce.number().int().min(3).max(60),
  postsPerCreator: z.coerce.number().int().min(1).max(5),
  creators: z.coerce.number().int().min(1).max(10).optional(),
  platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1, "Pick at least one platform"),
  disclosureText: z.string().trim().min(2).max(40).default("#ad"),
});

function readCampaignForm(form: FormData) {
  return CampaignForm.parse({
    ...Object.fromEntries([...form.entries()].filter(([k]) => k !== "platforms")),
    platforms: form.getAll("platforms").map(String),
    creators: form.get("creators") ? form.get("creators") : undefined,
  });
}

/** Live preview of the planner for the create form — uses the project's own Economics rules; no writes. */
export async function previewPlanAction(input: { budget: string; maxCpa: string; days: number; postsPerCreator: number; creators?: number; actionLabel?: string }): Promise<ActionResult<CampaignPlan>> {
  try {
    const { project, db } = await guard("view");
    const budget = toMicro(usdc.parse(input.budget));
    const maxCpa = toMicro(usdc.parse(input.maxCpa));
    if (budget <= 0 || maxCpa <= 0) return { ok: false, error: "Enter a budget and a max cost per action" };
    const econ = await getEconomics(db, project.id);
    return { ok: true, data: planCampaign({ budgetMicro: budget, maxCostPerActionMicro: maxCpa, days: input.days, postsPerCreator: input.postsPerCreator, creators: input.creators, actionLabel: input.actionLabel, rules: planRules(econ.values), rulesSource: econ.saved ? "setting" : "starting" }) };
  } catch (e) {
    return fail(e);
  }
}

/** What the project's own data says about an action, and the max cost per action it supports. */
export async function economicsForAction(targetEvent: string): Promise<ActionResult<{ measured: Measured; suggestion: CeilingSuggestion; saved: boolean }>> {
  try {
    const { project, db } = await guard("view");
    const ev = z.enum(CONVERSION_EVENTS).parse(targetEvent);
    const econ = await getEconomics(db, project.id);
    const measured = await measureEconomics(db, project.id, ev);
    return { ok: true, data: { measured, suggestion: suggestCeiling(econ, measured), saved: econ.saved } };
  } catch (e) {
    return fail(e);
  }
}

const EconomicsForm = z.object({
  customerValue: z.union([z.literal(""), usdc]).default(""),
  grossMarginPct: z.union([z.literal(""), z.coerce.number().int().min(1).max(100)]).default(""),
  acquisitionSharePct: z.coerce.number().int().min(1).max(100),
  conversionRatePct: z.union([z.literal(""), z.coerce.number().min(0.01).max(100)]).default(""),
  fixedPaySharePct: z.coerce.number().int().min(0).max(60),
  actionBonusSharePct: z.coerce.number().int().min(10).max(100),
  minActionsPerCreator: z.coerce.number().int().min(1).max(20),
  maxCreators: z.coerce.number().int().min(1).max(25),
  testPhaseSharePct: z.coerce.number().int().min(10).max(100),
  holdbackDays: z.coerce.number().int().min(0).max(60),
});

export async function saveEconomicsAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = EconomicsForm.parse(Object.fromEntries(form.entries()));
    const values = {
      customerValueMicro: f.customerValue === "" ? null : toMicro(f.customerValue),
      grossMarginPct: f.grossMarginPct === "" ? null : f.grossMarginPct,
      acquisitionSharePct: f.acquisitionSharePct,
      conversionRateBps: f.conversionRatePct === "" ? null : Math.round(f.conversionRatePct * 100),
      fixedPaySharePct: f.fixedPaySharePct,
      actionBonusSharePct: f.actionBonusSharePct,
      minActionsPerCreator: f.minActionsPerCreator,
      maxCreators: f.maxCreators,
      testPhaseSharePct: f.testPhaseSharePct,
      holdbackDays: f.holdbackDays,
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    await db.insert(s.projectEconomics).values({ projectId: project.id, ...values }).onConflictDoUpdate({ target: s.projectEconomics.projectId, set: values });
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "economics.update", data: values as unknown as Record<string, unknown> });
    revalidatePath("/app/settings");
    revalidatePath("/app/campaigns", "layout");
    return { ok: true, message: "Economics saved — new campaigns use these figures" };
  } catch (e) {
    return fail(e);
  }
}

export async function releaseHeldBudgetAction(campaignId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    const r = await releaseHeldBudget(db, { projectId: project.id, campaignId, userId: user.id });
    revalidatePath(`/app/campaigns/${campaignId}`);
    if (!r.released) return { ok: false, error: r.skipped.length ? `No creator qualifies yet: ${r.skipped.map((x) => x.reason).join("; ")}` : "No accepted creators with results yet" };
    return { ok: true, message: `Released ${(r.released / 1e6).toFixed(2)} USDC to ${r.grants.length} creator${r.grants.length === 1 ? "" : "s"} whose results beat the ceiling` };
  } catch (e) {
    return fail(e);
  }
}

export async function createCampaignAction(_: unknown, form: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const { project, db, user } = await guard("operate");
    const f = readCampaignForm(form);
    const c = await createCampaign(db, {
      projectId: project.id,
      userId: user.id,
      name: f.name,
      topic: f.topic,
      topicTerms: f.topicTerms.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
      brief: f.brief,
      destinationUrl: f.destinationUrl,
      targetEvent: f.targetEvent,
      maxCostPerActionMicro: toMicro(f.maxCpa),
      budgetMicro: toMicro(f.budget),
      days: f.days,
      postsPerCreator: f.postsPerCreator,
      creators: f.creators,
      platforms: f.platforms,
      disclosureText: f.disclosureText,
    });
    revalidatePath("/app/campaigns");
    return { ok: true, data: { id: c.id }, message: `Campaign #${c.number} is open — share the join link with creators` };
  } catch (e) {
    return fail(e);
  }
}

export async function decideParticipantAction(campaignId: string, participantId: string, accept: boolean): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await decideParticipant(db, { projectId: project.id, campaignId, participantId, accept, userId: user.id });
    revalidatePath(`/app/campaigns/${campaignId}`);
    return { ok: true, message: accept ? "Creator accepted — their tracking link is live" : "Application declined" };
  } catch (e) {
    return fail(e);
  }
}

const Review = z.object({
  relevance: z.coerce.number().int().min(0).max(5),
  depth: z.coerce.number().int().min(0).max(5),
  accuracy: z.coerce.number().int().min(0).max(5),
  disclosure: z.boolean(),
  discussion: z.coerce.number().int().min(0).max(3),
  note: z.string().max(500).default(""),
});

export async function reviewPostAction(campaignId: string, postId: string, accept: boolean, review: z.input<typeof Review>): Promise<ActionResult<{ score: number }>> {
  try {
    const { project, db, user } = await guard("operate");
    const r = await reviewPost(db, { projectId: project.id, postId, accept, review: Review.parse(review), userId: user.id });
    revalidatePath(`/app/campaigns/${campaignId}`);
    const earned = r.rewards.reduce((a, x) => a + x.amountMicro, 0);
    return { ok: true, data: { score: r.score }, message: accept ? (earned ? `Accepted — ${(earned / 1e6).toFixed(2)} USDC earned` : "Accepted — no reward (post limit or ceiling reached)") : "Post rejected" };
  } catch (e) {
    return fail(e);
  }
}

export async function syncCampaignAction(campaignId: string): Promise<ActionResult> {
  try {
    const { project, db } = await guard("operate");
    const c = await getCampaign(db, project.id, campaignId);
    if (!c) return { ok: false, error: "Campaign not found" };
    const n = await syncActionRewards(db, c);
    revalidatePath(`/app/campaigns/${campaignId}`);
    return { ok: true, message: n ? `${n} new verified action${n === 1 ? "" : "s"} credited` : "No new verified actions" };
  } catch (e) {
    return fail(e);
  }
}

export async function proposePayoutAction(campaignId: string, participantId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await limited(`payout:${user.id}`, 10, 0.1);
    const r = await proposePayout(db, { projectId: project.id, campaignId, participantId, userId: user.id });
    revalidatePath(`/app/campaigns/${campaignId}`);
    revalidatePath("/app", "layout");
    const amount = (r.amountMicro / 1e6).toFixed(2);
    const msg =
      r.state === "AWAITING_APPROVAL"
        ? `Payout of ${amount} USDC sent to the Approval Inbox`
        : r.verdict === "DENY"
          ? `Payout denied by policy: ${r.message}`
          : r.state === "SIMULATED"
            ? `Payout of ${amount} USDC simulated — no funds moved`
            : r.state === "SUBMITTED" || r.state === "SETTLED"
              ? `Payout of ${amount} USDC submitted on-chain`
              : `Payout ${r.state.toLowerCase()}: ${r.message}`;
    return r.verdict === "DENY" ? { ok: false, error: msg } : { ok: true, message: msg };
  } catch (e) {
    return fail(e);
  }
}

export async function closeCampaignAction(campaignId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await closeCampaign(db, { projectId: project.id, campaignId, userId: user.id });
    revalidatePath(`/app/campaigns/${campaignId}`);
    revalidatePath("/app/campaigns");
    return { ok: true, message: "Campaign closed — earned rewards can still be paid" };
  } catch (e) {
    return fail(e);
  }
}

// ───────────── public (creator-facing, no account) ─────────────

const Join = z.object({
  provider: z.enum(PLATFORMS as [string, ...string[]]),
  handle: z.string().trim().min(1).max(64),
  displayName: z.string().max(80).optional(),
  contact: z.string().max(120).optional(),
  payoutAddress: z.string().trim(),
  pitch: z.string().max(600).optional(),
  agreeRules: z.literal("on", { message: "Accept the campaign rules to join" }),
  agreeDisclosure: z.literal("on", { message: "Accept the disclosure requirement to join" }),
});

export async function joinCampaignAction(joinToken: string, _: unknown, form: FormData): Promise<ActionResult<{ accessToken: string }>> {
  try {
    await limited("campaign-join", 5, 0.02);
    const f = Join.parse(Object.fromEntries(form.entries()));
    const db = await getDb();
    const r = await joinCampaign(db, joinToken, { ...f, agreeRules: true, agreeDisclosure: true });
    return { ok: true, data: { accessToken: r.accessToken }, message: "Application received" };
  } catch (e) {
    return fail(e);
  }
}

export async function submitPostAction(accessToken: string, _: unknown, form: FormData): Promise<ActionResult> {
  try {
    await limited("campaign-submit", 20, 0.1);
    const url = z.string().trim().min(8).max(500).parse(form.get("url"));
    const note = z.string().max(400).optional().parse(form.get("note") || undefined);
    const db = await getDb();
    await submitPost(db, accessToken, { url, note });
    revalidatePath(`/creator/${accessToken}`);
    return { ok: true, message: "Submitted — the business reviews posts against the published rubric" };
  } catch (e) {
    return fail(e);
  }
}
