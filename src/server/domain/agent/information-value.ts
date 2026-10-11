import { fmtUsdc } from "@/lib/money";

/**
 * "Is this information worth paying for?"
 *
 * GrowTendril commits budget to an opportunity only when confidence ≥ COMMIT_THRESHOLD.
 * Buying data is worth it when it is likely to move confidence across that line
 * (either way) and the budget at stake is large relative to the price.
 *
 *   gap     = threshold − confidence
 *   pFlip   = P(the purchase changes the decision) ≈ min(1, expectedLift / gap) · reliability
 *   EVI     = stake · pFlip · lossFraction        (expected misallocation avoided)
 *   BUY  iff  price · SAFETY_MARGIN ≤ EVI  and  price ≤ maxPerCall
 */

export const COMMIT_THRESHOLD = 0.8;
export const SAFETY_MARGIN = 2;
/** Share of an experiment's budget expected to be wasted if launched on a false positive. */
export const LOSS_FRACTION = 0.25;

export interface InfoValueInput {
  confidence: number;
  stakeMicro: number;
  priceMicro: number;
  expectedLift: number; // expected confidence change from this data source, 0-1
  reliability: number; // 0-1, how trustworthy this service's data has been
  maxPerCallMicro: number;
}

export interface InfoValueResult {
  buy: boolean;
  eviMicro: number;
  pFlip: number;
  ratio: number; // EVI ÷ price
  expectedValue: "low" | "medium" | "high";
  reasons: string[];
}

export function evaluateInformationValue(i: InfoValueInput): InfoValueResult {
  const gap = COMMIT_THRESHOLD - i.confidence;
  const pFlip = gap <= 0 ? 0.05 : Math.min(1, i.expectedLift / gap) * i.reliability;
  const eviMicro = Math.round(i.stakeMicro * pFlip * LOSS_FRACTION);
  const ratio = i.priceMicro > 0 ? eviMicro / i.priceMicro : Infinity;
  const withinCap = i.priceMicro <= i.maxPerCallMicro;
  const buy = withinCap && i.priceMicro * SAFETY_MARGIN <= eviMicro;
  const expectedValue = ratio >= 100 ? "high" : ratio >= 10 ? "medium" : "low";
  const reasons = [
    gap <= 0
      ? `Confidence ${(i.confidence * 100).toFixed(0)}% already ≥ ${(COMMIT_THRESHOLD * 100).toFixed(0)}% commit threshold — little to learn`
      : `Confidence ${(i.confidence * 100).toFixed(0)}% is ${(gap * 100).toFixed(0)} pts below the ${(COMMIT_THRESHOLD * 100).toFixed(0)}% commit threshold`,
    `${fmtUsdc(i.stakeMicro)} of budget depends on this decision`,
    `P(data changes the decision) ≈ ${(pFlip * 100).toFixed(0)}%`,
    `Expected value of information ≈ ${fmtUsdc(eviMicro)} vs price ${fmtUsdc(i.priceMicro)} (${Number.isFinite(ratio) ? `${Math.round(ratio)}×` : "∞"})`,
    withinCap ? `Price within per-call research cap ${fmtUsdc(i.maxPerCallMicro)}` : `Price exceeds per-call research cap ${fmtUsdc(i.maxPerCallMicro)}`,
  ];
  return { buy, eviMicro, pFlip: Math.round(pFlip * 100) / 100, ratio, expectedValue, reasons };
}
