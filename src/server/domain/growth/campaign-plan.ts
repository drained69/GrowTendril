import { fmtUsdc } from "@/lib/money";

/**
 * Creator campaign budget planner (pure). Instead of a fixed percentage split, every number is
 * derived from what the business told us: the action it wants, the most it can afford per action,
 * and a test budget. Each output carries the sentence that justifies it.
 */
export interface PlanInput {
  budgetMicro: number;
  maxCostPerActionMicro: number;
  days?: number;
  postsPerCreator?: number;
  creators?: number;
  actionLabel?: string;
}

export interface CampaignPlan {
  days: number;
  creators: number;
  postsPerCreator: number;
  creatorCapMicro: number;
  basePayMicro: number;
  discussionBonusCapMicro: number;
  actionBonusMicro: number;
  fixedPoolMicro: number;
  actionPoolMicro: number;
  actionsAtFullSpend: number;
  worstCaseCostPerActionMicro: number | null;
  warnings: string[];
  reasoning: string[];
}

/** Each creator needs room for at least this many paid actions, or the test can't tell creators apart. */
export const MIN_ACTIONS_PER_CREATOR = 3;
/** Fixed pay (accepted posts + discussion) is capped at this share of a creator's ceiling: most money follows results. */
export const MAX_FIXED_SHARE = 0.25;
/** Verified actions are paid below the ceiling so a creator's base pay still fits under it. */
export const ACTION_BONUS_SHARE = 0.8;

const round = (micro: number) => Math.max(0, Math.floor(micro / 10_000) * 10_000); // whole cents

export function planCampaign(input: PlanInput): CampaignPlan {
  const budget = Math.max(0, Math.floor(input.budgetMicro));
  const cpa = Math.max(1, Math.floor(input.maxCostPerActionMicro));
  const days = Math.min(60, Math.max(3, Math.round(input.days ?? 14)));
  const posts = Math.min(5, Math.max(1, Math.round(input.postsPerCreator ?? 2)));
  const affordable = Math.floor(budget / (MIN_ACTIONS_PER_CREATOR * cpa));
  const creators = Math.min(10, Math.max(1, Math.round(input.creators ?? Math.min(10, Math.max(1, affordable)))));
  const creatorCap = round(budget / creators);
  const basePay = round(Math.min(cpa, (creatorCap * MAX_FIXED_SHARE) / (posts * 1.5)));
  const discussionCap = round(basePay / 2);
  const actionBonus = round(cpa * ACTION_BONUS_SHARE);
  const fixedPool = creators * posts * (basePay + discussionCap);
  const actionPool = Math.max(0, budget - fixedPool);
  const actions = actionBonus > 0 ? Math.floor(actionPool / actionBonus) : 0;
  const worst = actions > 0 ? Math.round((fixedPool + actions * actionBonus) / actions) : null;

  const warnings: string[] = [];
  if (budget < cpa * MIN_ACTIONS_PER_CREATOR) warnings.push(`The budget covers fewer than ${MIN_ACTIONS_PER_CREATOR} actions at ${fmtUsdc(cpa)} each — raise the budget or the result will be noise.`);
  if (creators < 5) warnings.push(`Only ${creators} creator${creators === 1 ? "" : "s"} fit this budget at ${fmtUsdc(cpa)} per action. 5–10 gives a more reliable comparison.`);
  if (basePay === 0) warnings.push("Base pay rounds to zero — creators would be paid only for verified actions.");
  if (worst != null && worst > cpa) warnings.push(`If every creator maxes out fixed pay, the blended cost per action (${fmtUsdc(worst)}) exceeds your ceiling. Base pay is the price of the test; bonuses never exceed it.`);

  const reasoning = [
    `${creators} creator${creators === 1 ? "" : "s"}: each needs room for at least ${MIN_ACTIONS_PER_CREATOR} paid actions at your ${fmtUsdc(cpa)} ceiling (${fmtUsdc(budget)} ÷ (${MIN_ACTIONS_PER_CREATOR} × ${fmtUsdc(cpa)}) = ${affordable}, capped at 10).`,
    `Per-creator ceiling ${fmtUsdc(creatorCap)}: the budget split evenly, so no single creator can consume the test.`,
    `Base pay ${fmtUsdc(basePay)} per accepted post (up to ${posts}): fixed pay is held to ${Math.round(MAX_FIXED_SHARE * 100)}% of a creator's ceiling and never above one action's worth.`,
    `Discussion bonus up to ${fmtUsdc(discussionCap)} per post: half of base pay, only for discussion a reviewer marks as useful.`,
    `${fmtUsdc(actionBonus)} per verified ${input.actionLabel ?? "action"}: ${Math.round(ACTION_BONUS_SHARE * 100)}% of your ceiling, so a creator's results stay under what you said an action is worth.`,
    `${fmtUsdc(actionPool)} (${budget ? Math.round((actionPool / budget) * 100) : 0}%) is reserved for verified actions — about ${actions} at full spend. Unearned money is never paid.`,
    `${days} days: long enough for posts to circulate and for the target action to happen after a click.`,
  ];

  return {
    days,
    creators,
    postsPerCreator: posts,
    creatorCapMicro: creatorCap,
    basePayMicro: basePay,
    discussionBonusCapMicro: discussionCap,
    actionBonusMicro: actionBonus,
    fixedPoolMicro: fixedPool,
    actionPoolMicro: actionPool,
    actionsAtFullSpend: actions,
    worstCaseCostPerActionMicro: worst,
    warnings,
    reasoning,
  };
}

/** Rubric → 0–100 quality score. Disclosure is a gate, not a score. */
export function qualityScore(r: { relevance: number; depth: number; accuracy: number }): number {
  const c = (n: number) => Math.min(5, Math.max(0, Math.round(n)));
  return Math.round(((c(r.relevance) + c(r.depth) + c(r.accuracy)) / 15) * 100);
}

/** Phrases that clearly disclose a paid relationship (FTC-style). The reviewer still confirms. */
const DISCLOSURE_RE = /(^|[\s(])#(ad|sponsored|paid|partner|paidpartnership)\b|\b(paid partnership|sponsored by|in partnership with|paid by|this (post|video) is sponsored|ad:)\b/i;
export function detectDisclosure(text: string | null | undefined, custom?: string | null): boolean | null {
  if (!text) return null;
  if (custom && custom.trim() && text.toLowerCase().includes(custom.trim().toLowerCase())) return true;
  return DISCLOSURE_RE.test(text);
}

/** Apply per-creator and campaign ceilings to a reward. Returns the amount that may be accrued. */
export function capReward(amountMicro: number, a: { creatorEarnedMicro: number; creatorCapMicro: number; campaignEarnedMicro: number; budgetMicro: number }): { amountMicro: number; capped: "creator" | "budget" | null } {
  const roomCreator = Math.max(0, a.creatorCapMicro - a.creatorEarnedMicro);
  const roomBudget = Math.max(0, a.budgetMicro - a.campaignEarnedMicro);
  const amount = Math.max(0, Math.min(amountMicro, roomCreator, roomBudget));
  return { amountMicro: amount, capped: amount < amountMicro ? (roomBudget < roomCreator ? "budget" : "creator") : null };
}

const HOSTS: Record<string, RegExp> = {
  x: /(^|\.)(x\.com|twitter\.com)$/i,
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
  github: /(^|\.)github\.com$/i,
  reddit: /(^|\.)reddit\.com$/i,
  hackernews: /(^|\.)news\.ycombinator\.com$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
};
export const PLATFORM_LABEL: Record<string, string> = { x: "X", youtube: "YouTube", github: "GitHub", reddit: "Reddit", hackernews: "Hacker News", linkedin: "LinkedIn", blog: "Blog / newsletter" };
export const PLATFORMS = Object.keys(PLATFORM_LABEL);

/** A submitted post must be an https URL on the creator's platform (any host for blogs). */
export function validPostUrl(url: string, platform: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Enter the full link to the post";
  }
  if (u.protocol !== "https:") return "Links must start with https://";
  const re = HOSTS[platform];
  if (re && !re.test(u.hostname)) return `This campaign entry is for ${PLATFORM_LABEL[platform]} — the link should be on that site`;
  return null;
}

export function normalizeHandle(h: string): string {
  return h.trim().replace(/^@+/, "").toLowerCase();
}
