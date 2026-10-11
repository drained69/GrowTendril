import { fmtUsdc } from "@/lib/money";

/**
 * Creator campaign budget planner (pure). No hidden constants: every number is derived from what
 * the business typed (target action, max cost per action, test budget) and the project's own rules
 * from Settings → Economics. Each output carries the sentence that justifies it.
 *
 * Budget follows results: only the test phase is released to creators at launch. The rest is held
 * and released later only to creators whose measured cost per action beats the ceiling.
 */
export interface PlanRules {
  /** Max share of a creator's ceiling paid as fixed pay (accepted posts + discussion). */
  fixedPayShare: number;
  /** Bonus per verified action as a share of the max cost per action. */
  actionBonusShare: number;
  /** Each creator needs room for this many paid actions in the test phase. */
  minActionsPerCreator: number;
  maxCreators: number;
  /** Share of the budget released at launch; the rest waits for measured results. */
  testPhaseShare: number;
  /** Days before a verified action becomes payable. */
  holdbackDays: number;
}

/** Starting rules for a project that hasn't saved its own (shown as "starting value" in the UI). */
export const STARTING_RULES: PlanRules = { fixedPayShare: 0.25, actionBonusShare: 0.8, minActionsPerCreator: 3, maxCreators: 10, testPhaseShare: 0.5, holdbackDays: 7 };

export interface PlanInput {
  budgetMicro: number;
  maxCostPerActionMicro: number;
  days?: number;
  postsPerCreator?: number;
  creators?: number;
  actionLabel?: string;
  rules?: PlanRules;
  /** Where the rules came from, for the reasoning text. */
  rulesSource?: "setting" | "starting";
}

export interface CampaignPlan {
  days: number;
  creators: number;
  postsPerCreator: number;
  /** Test-phase ceiling per creator. Raised later only by results-based release. */
  creatorCapMicro: number;
  basePayMicro: number;
  discussionBonusCapMicro: number;
  actionBonusMicro: number;
  testPhaseMicro: number;
  heldForResultsMicro: number;
  fixedPoolMicro: number;
  actionPoolMicro: number;
  actionsInTestPhase: number;
  actionsAtFullSpend: number;
  worstCaseCostPerActionMicro: number | null;
  holdbackDays: number;
  rules: PlanRules;
  rulesSource: "setting" | "starting";
  warnings: string[];
  reasoning: string[];
}

const round = (micro: number) => Math.max(0, Math.floor(micro / 10_000) * 10_000); // whole cents
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function planCampaign(input: PlanInput): CampaignPlan {
  const rules = input.rules ?? STARTING_RULES;
  const src = input.rulesSource ?? "starting";
  const rulesNote = src === "setting" ? "your Economics setting" : "starting value — review in Settings → Economics";
  const budget = Math.max(0, Math.floor(input.budgetMicro));
  const cpa = Math.max(1, Math.floor(input.maxCostPerActionMicro));
  const days = Math.min(60, Math.max(3, Math.round(input.days ?? 14)));
  const posts = Math.min(5, Math.max(1, Math.round(input.postsPerCreator ?? 2)));
  const testShare = Math.min(1, Math.max(0.1, rules.testPhaseShare));
  const testPhase = round(budget * testShare);
  const maxCreators = Math.min(25, Math.max(1, Math.round(rules.maxCreators)));
  const minActions = Math.max(1, Math.round(rules.minActionsPerCreator));
  const affordable = Math.floor(testPhase / (minActions * cpa));
  const creators = Math.min(maxCreators, Math.max(1, Math.round(input.creators ?? Math.min(maxCreators, Math.max(1, affordable)))));
  const creatorCap = round(testPhase / creators);
  const basePay = round(Math.min(cpa, (creatorCap * rules.fixedPayShare) / (posts * 1.5)));
  const discussionCap = round(basePay / 2);
  const actionBonus = round(cpa * Math.min(1, Math.max(0, rules.actionBonusShare)));
  const fixedPool = creators * posts * (basePay + discussionCap);
  const actionPool = Math.max(0, budget - fixedPool);
  const actionsTest = actionBonus > 0 ? Math.floor(Math.max(0, testPhase - fixedPool) / actionBonus) : 0;
  const actions = actionBonus > 0 ? Math.floor(actionPool / actionBonus) : 0;
  const worst = actions > 0 ? Math.round((fixedPool + actions * actionBonus) / actions) : null;
  const label = input.actionLabel ?? "action";

  const warnings: string[] = [];
  if (testPhase < cpa * minActions) warnings.push(`The test phase covers fewer than ${minActions} ${label}s at ${fmtUsdc(cpa)} each — raise the budget or the test-phase share, or the result will be noise.`);
  if (creators < 5) warnings.push(`Only ${creators} creator${creators === 1 ? "" : "s"} fit the test phase at ${fmtUsdc(cpa)} per action. 5–10 gives a more reliable comparison.`);
  if (basePay === 0) warnings.push("Base pay rounds to zero — creators would be paid only for verified actions.");
  if (worst != null && worst > cpa) warnings.push(`If every creator maxes out fixed pay, the blended cost per action (${fmtUsdc(worst)}) exceeds your ceiling. Base pay is the price of the test; action bonuses never exceed it.`);

  const reasoning = [
    `Test phase ${fmtUsdc(testPhase)} (${pct(testShare)} of the budget, ${rulesNote}). The other ${fmtUsdc(budget - testPhase)} is held and released only to creators whose measured cost per action beats ${fmtUsdc(cpa)}.`,
    `${creators} creator${creators === 1 ? "" : "s"}: each needs room for ${minActions} paid ${label}s at your ceiling in the test phase (${fmtUsdc(testPhase)} ÷ (${minActions} × ${fmtUsdc(cpa)}) = ${affordable}, max ${maxCreators}).`,
    `Test-phase ceiling ${fmtUsdc(creatorCap)} per creator: the test phase split evenly, so no single creator can consume the test.`,
    `Base pay ${fmtUsdc(basePay)} per accepted post (up to ${posts}): fixed pay stays within ${pct(rules.fixedPayShare)} of a creator's ceiling (${rulesNote}) and never above one action's worth.`,
    `Discussion bonus up to ${fmtUsdc(discussionCap)} per post: half of base pay, only for discussion a reviewer rates as useful.`,
    `${fmtUsdc(actionBonus)} per verified ${label}: ${pct(rules.actionBonusShare)} of your ceiling (${rulesNote}), payable ${rules.holdbackDays} day${rules.holdbackDays === 1 ? "" : "s"} after the action so fake or reversed ones can be caught first.`,
    `About ${actionsTest} verified ${label}s fit in the test phase and ${actions} at full spend. Unearned money is never paid.`,
    `${days} days: long enough for posts to circulate and for the ${label} to happen after a click.`,
  ];

  return {
    days,
    creators,
    postsPerCreator: posts,
    creatorCapMicro: creatorCap,
    basePayMicro: basePay,
    discussionBonusCapMicro: discussionCap,
    actionBonusMicro: actionBonus,
    testPhaseMicro: testPhase,
    heldForResultsMicro: budget - testPhase,
    fixedPoolMicro: fixedPool,
    actionPoolMicro: actionPool,
    actionsInTestPhase: actionsTest,
    actionsAtFullSpend: actions,
    worstCaseCostPerActionMicro: worst,
    holdbackDays: Math.max(0, Math.round(rules.holdbackDays)),
    rules,
    rulesSource: src,
    warnings,
    reasoning,
  };
}

/**
 * Results-based release: the held budget goes only to creators with enough verified actions whose
 * measured cost per action (everything they earned ÷ verified actions) is at or below the ceiling,
 * in proportion to their verified actions. Pure; the caller persists it.
 */
export function releaseToWinners(a: {
  heldMicro: number;
  maxCostPerActionMicro: number;
  minActions: number;
  creators: { id: string; handle: string; earnedMicro: number; actions: number }[];
}): { grants: { id: string; amountMicro: number; reason: string }[]; skipped: { id: string; reason: string }[] } {
  const skipped: { id: string; reason: string }[] = [];
  const winners: { id: string; handle: string; actions: number; cpa: number }[] = [];
  for (const c of a.creators) {
    if (c.actions < a.minActions) {
      skipped.push({ id: c.id, reason: `@${c.handle}: ${c.actions} verified action${c.actions === 1 ? "" : "s"} — needs ${a.minActions} before results count` });
      continue;
    }
    const cpa = Math.round(c.earnedMicro / c.actions);
    if (cpa > a.maxCostPerActionMicro) skipped.push({ id: c.id, reason: `@${c.handle}: measured ${fmtUsdc(cpa)} per action is above the ${fmtUsdc(a.maxCostPerActionMicro)} ceiling` });
    else winners.push({ id: c.id, handle: c.handle, actions: c.actions, cpa });
  }
  const total = winners.reduce((x, w) => x + w.actions, 0);
  const grants = winners
    .map((w) => {
      const amount = round((a.heldMicro * w.actions) / total);
      return { id: w.id, amountMicro: amount, reason: `@${w.handle}: ${w.actions} verified actions at ${fmtUsdc(w.cpa)} each (ceiling ${fmtUsdc(a.maxCostPerActionMicro)}) — ${Math.round((w.actions / total) * 100)}% of winners' actions` };
    })
    .filter((g) => g.amountMicro > 0);
  return { grants, skipped };
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
