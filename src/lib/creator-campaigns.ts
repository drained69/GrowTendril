import { z } from "zod";

export const CAMPAIGN_PLATFORMS = ["bluesky", "x", "youtube", "rss"] as const;
export const CAMPAIGN_GOALS = ["signup", "lead", "demo_request", "purchase", "sdk_key_created", "sdk_install", "wallet_connect"] as const;
const amount = z.string().trim().regex(/^\d{1,6}(\.\d{1,6})?$/, "Enter a USDC amount with at most six decimal places").transform(v => Math.round(Number(v) * 1e6));
export const CampaignInput = z.object({
  title: z.string().trim().min(3).max(100),
  topic: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(30).max(3000),
  platform: z.enum(CAMPAIGN_PLATFORMS),
  goal: z.enum(CAMPAIGN_GOALS),
  target: z.coerce.number().int().min(1).max(10000),
  maxCpa: amount.refine(v => v > 0, "Maximum cost per action must be positive"),
  cashLimit: amount.refine(v => v > 0, "Test budget must be positive"),
  slots: z.coerce.number().int().min(1).max(10),
  base: amount.refine(v => v > 0, "Base reward must be positive"),
  qualityBonus: amount,
  outcomeBonus: amount,
  outcomeCap: z.coerce.number().int().min(0).max(100),
});
export type CampaignTerms = z.infer<typeof CampaignInput>;

export function campaignEconomics(v: CampaignTerms) {
  const ceiling = Math.min(v.cashLimit, v.target * v.maxCpa);
  const perCreator = v.base + v.qualityBonus + v.outcomeBonus * v.outcomeCap;
  const reserved = perCreator * v.slots;
  if (perCreator > 10e6) throw new Error("Each creator's total reward must be at most 10 USDC for this pilot");
  if (reserved > ceiling) throw new Error("Creator rewards exceed the lower of your test budget and target × maximum cost per action. Reduce the slots or rewards.");
  return { ceiling, perCreator, reserved, unallocated: ceiling - reserved };
}

export const QUALITY_CRITERIA = { relevance: "Relevance to the brief", originality: "Original experience or analysis", usefulness: "Specific, useful information", discussion: "Substantive audience discussion" } as const;
export const ReviewInput = z.object({
  relevance: z.coerce.number().int().min(0).max(5), originality: z.coerce.number().int().min(0).max(5),
  usefulness: z.coerce.number().int().min(0).max(5), discussion: z.coerce.number().int().min(0).max(5),
  note: z.string().trim().min(20).max(1500),
  decision: z.enum(["accepted", "rejected"]),
});
export function qualityScore(v: z.infer<typeof ReviewInput>) { return (v.relevance + v.originality + v.usefulness + v.discussion) * 5; }
export function rewardFor(v: { baseMicro: number; qualityBonusMicro: number; outcomeBonusMicro: number; outcomeCap: number }, score: number, outcomes: number) {
  return v.baseMicro + Math.floor(v.qualityBonusMicro * score / 100) + v.outcomeBonusMicro * Math.min(outcomes, v.outcomeCap);
}
export function publicLink(value: string) {
  const u = new URL(value.trim());
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)) throw new Error("Use a public HTTPS link");
  u.hash = "";
  return u.toString();
}
