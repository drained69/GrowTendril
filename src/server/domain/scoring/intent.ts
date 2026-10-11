import { INTENT_WEIGHT, SIGNAL_LABEL, termHits, type SignalType } from "@/server/domain/intel/signals";
import { DAY_MS } from "@/lib/time";

/**
 * Customer-opportunity scoring. The LLM never sets a score: it may help classify evidence,
 * but the numbers below come from transparent, weighted components.
 */

export interface ScoreComponent {
  score: number; // 0-100
  weight: number; // contribution to overall
  reasons: string[];
}

export interface EvidenceInput {
  signalType: SignalType;
  observedAt: Date;
  sourceUrl: string;
  provider: string;
  excerpt: string;
  classifiedBy: string; // rule | claude | x402 | demo
  hasNamedPerson?: boolean;
}

export interface CompanyScore {
  productFit: ScoreComponent;
  timing: ScoreComponent;
  buyingIntent: ScoreComponent;
  evidenceQuality: ScoreComponent;
  engagementOpportunity: ScoreComponent;
  overall: number;
  confidence: number;
}

export const COMPANY_WEIGHTS = {
  productFit: 0.25,
  timing: 0.2,
  buyingIntent: 0.25,
  evidenceQuality: 0.15,
  engagementOpportunity: 0.15,
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const ageDays = (d: Date, now: number) => Math.max(0, (now - d.getTime()) / DAY_MS);
/** Half-life of ~7 days: a week-old signal is worth half a fresh one. */
export const recency = (d: Date, now: number) => Math.pow(0.5, ageDays(d, now) / 7);

export function scoreCompany(
  evidence: EvidenceInput[],
  ctx: { keywords: string[]; icpTerms: string[]; now?: number },
): CompanyScore {
  const now = ctx.now ?? Date.now();
  const text = evidence.map((e) => e.excerpt).join("\n");

  // PRODUCT FIT — does the public evidence overlap our product's vocabulary and ICP?
  const kwHits = termHits(text, ctx.keywords);
  const icpHits = termHits(text, ctx.icpTerms);
  const kwDenominator = Math.max(1, Math.min(5, ctx.keywords.length));
  const fitScore = clamp(Math.round((Math.min(kwHits.length, kwDenominator) / kwDenominator) * 70 + Math.min(icpHits.length, 3) * 10));
  const productFit: ScoreComponent = {
    score: fitScore,
    weight: COMPANY_WEIGHTS.productFit,
    reasons: [
      kwHits.length ? `Mentions product terms: ${kwHits.slice(0, 5).join(", ")}` : "No product terms found in evidence",
      icpHits.length ? `Matches ICP: ${icpHits.slice(0, 3).join(", ")}` : "No explicit ICP segment match",
    ],
  };

  // TIMING — recency of the strongest signals.
  const recencies = evidence.map((e) => ({ e, r: recency(e.observedAt, now) })).sort((a, b) => b.r - a.r);
  const timingRaw = recencies.slice(0, 3).reduce((s, x, i) => s + x.r * [0.6, 0.25, 0.15][i], 0);
  const freshest = recencies[0];
  const timing: ScoreComponent = {
    score: clamp(Math.round(timingRaw * 100)),
    weight: COMPANY_WEIGHTS.timing,
    reasons: freshest
      ? [`Most recent signal ${Math.round(ageDays(freshest.e.observedAt, now))}d ago (${SIGNAL_LABEL[freshest.e.signalType]})`, `${evidence.filter((e) => ageDays(e.observedAt, now) <= 7).length} signal(s) in the last 7 days`]
      : ["No dated signals"],
  };

  // BUYING INTENT — strongest instance of each distinct signal type, decayed by age.
  const bestByType = new Map<SignalType, number>();
  for (const { e, r } of recencies) {
    const v = INTENT_WEIGHT[e.signalType] * (0.5 + 0.5 * r);
    if ((bestByType.get(e.signalType) ?? 0) < v) bestByType.set(e.signalType, v);
  }
  const intentSorted = [...bestByType.entries()].sort((a, b) => b[1] - a[1]);
  // Noisy-OR: independent signals each have a chance of indicating real intent; a 40-weight
  // fresh signal alone ≈ 80. More independent signal types push toward 100 without double-counting.
  const intentP = 1 - intentSorted.reduce((prod, [, v]) => prod * (1 - Math.min(0.95, v / 50)), 1);
  const buyingIntent: ScoreComponent = {
    score: clamp(Math.round(intentP * 100)),
    weight: COMPANY_WEIGHTS.buyingIntent,
    reasons: intentSorted.slice(0, 4).map(([t, v]) => `${SIGNAL_LABEL[t]} (${Math.round(v)}/50)`),
  };

  // EVIDENCE QUALITY — independent sources, provider diversity, purchased verification.
  const distinctSources = new Set(evidence.map((e) => e.sourceUrl)).size;
  const providers = new Set(evidence.map((e) => e.provider)).size;
  const verified = evidence.some((e) => e.classifiedBy === "x402");
  const quality = clamp(Math.min(distinctSources, 3) * 18 + Math.min(providers, 2) * 12 + (verified ? 22 : 0));
  const evidenceQuality: ScoreComponent = {
    score: quality,
    weight: COMPANY_WEIGHTS.evidenceQuality,
    reasons: [
      `${distinctSources} independent source(s) across ${providers} provider(s)`,
      verified ? "Includes signals verified through a paid x402 data purchase" : "Not yet independently verified",
    ],
  };

  // ENGAGEMENT OPPORTUNITY — is there a legitimate, public way to engage (not cold spam)?
  const publicAsk = evidence.some((e) => e.signalType === "recommendation_request" || e.signalType === "question");
  const namedPerson = evidence.some((e) => e.hasNamedPerson);
  const publicThread = evidence.some((e) => ["github", "hackernews", "reddit", "bluesky", "x", "youtube"].includes(e.provider));
  const engagement = clamp((publicAsk ? 45 : 0) + (namedPerson ? 25 : 0) + (publicThread ? 30 : 10));
  const engagementOpportunity: ScoreComponent = {
    score: engagement,
    weight: COMPANY_WEIGHTS.engagementOpportunity,
    reasons: [
      publicAsk ? "Asked a public question we can answer in-thread" : "No open public question",
      publicThread ? "Active public thread you can join" : "No public thread to join",
      namedPerson ? "A named decision-maker is visible" : "No named contact",
    ],
  };

  const overall = Math.round(
    productFit.score * productFit.weight +
      timing.score * timing.weight +
      buyingIntent.score * buyingIntent.weight +
      evidenceQuality.score * evidenceQuality.weight +
      engagementOpportunity.score * engagementOpportunity.weight,
  );

  return { productFit, timing, buyingIntent, evidenceQuality, engagementOpportunity, overall, confidence: confidenceFrom(evidenceQuality.score, bestByType.size) };
}

/**
 * Agent confidence that an opportunity is real. Rises only when evidence quality or
 * signal diversity rises — so buying verified data can move it, but a prompt cannot.
 */
export function confidenceFrom(evidenceQuality: number, distinctSignalTypes: number): number {
  const c = 0.25 + 0.45 * (evidenceQuality / 100) + 0.2 * Math.min(1, distinctSignalTypes / 5);
  return Math.round(Math.min(0.95, c) * 100) / 100;
}
