import { fmtUsdc, microToDecimal } from "@/lib/money";

/**
 * Learning & reallocation engine. Inputs are *measured* numbers only: committed spend from
 * the transactions table (authorized, in flight, settled or simulated) and conversions joined through attribution. No LLM touches these.
 */

export interface ExperimentPerformance {
  experimentId: string;
  number: number;
  title: string;
  channel: string;
  status: string;
  budgetMicro: number;
  spentMicro: number;
  conversions: number; // qualified conversions (mission goal event)
  visits: number;
  successTarget: number;
  stopMaxCpaMicro: number;
  stopAfterSpendMicro: number;
}

export interface Finding {
  experimentId: string;
  label: string;
  spentMicro: number;
  conversions: number;
  cpaMicro: number | null;
  verdict: "SCALE" | "KEEP" | "REDUCE" | "STOP" | "INSUFFICIENT_DATA";
  reason: string;
}

export interface Reallocation {
  fromExperimentId: string;
  toExperimentId: string;
  amountMicro: number;
  amount: string;
  reason: string;
}

/** Minimum spend before CPA is trusted — avoids reallocating on noise. */
export const MIN_SPEND_FOR_SIGNAL_MICRO = 10_000_000;
export const MIN_CONVERSIONS_FOR_SCALE = 3;

export function cpa(spent: number, conversions: number): number | null {
  return conversions > 0 ? Math.round(spent / conversions) : null;
}

export function evaluateExperiments(perf: ExperimentPerformance[]): Finding[] {
  const measured = perf.filter((p) => p.spentMicro >= MIN_SPEND_FOR_SIGNAL_MICRO);
  const cpas = measured.map((p) => cpa(p.spentMicro, p.conversions)).filter((x): x is number => x != null);
  const median = cpas.length ? [...cpas].sort((a, b) => a - b)[Math.floor(cpas.length / 2)] : null;

  return perf.map((p) => {
    const c = cpa(p.spentMicro, p.conversions);
    const label = `#${p.number} ${p.title}`;
    const base = { experimentId: p.experimentId, label, spentMicro: p.spentMicro, conversions: p.conversions, cpaMicro: c };
    if (p.spentMicro < MIN_SPEND_FOR_SIGNAL_MICRO)
      return { ...base, verdict: "INSUFFICIENT_DATA" as const, reason: `Only ${fmtUsdc(p.spentMicro)} spent — below the ${fmtUsdc(MIN_SPEND_FOR_SIGNAL_MICRO)} signal threshold` };
    const stopTriggered = p.spentMicro >= p.stopAfterSpendMicro && (c == null || c > p.stopMaxCpaMicro);
    if (stopTriggered)
      return { ...base, verdict: "STOP" as const, reason: `Stop condition hit: CPA ${c == null ? "∞ (no conversions)" : fmtUsdc(c)} > ${fmtUsdc(p.stopMaxCpaMicro)} after ${fmtUsdc(p.spentMicro)}` };
    if (c == null) return { ...base, verdict: "REDUCE" as const, reason: `${fmtUsdc(p.spentMicro)} spent, no qualified conversions yet` };
    if (median != null && c <= median * 0.6 && p.conversions >= MIN_CONVERSIONS_FOR_SCALE)
      return { ...base, verdict: "SCALE" as const, reason: `CPA ${fmtUsdc(c)} is ≤60% of the mission median ${fmtUsdc(median)} with ${p.conversions} conversions` };
    if (median != null && c >= median * 1.6) return { ...base, verdict: "REDUCE" as const, reason: `CPA ${fmtUsdc(c)} is ≥160% of the mission median ${fmtUsdc(median)}` };
    return { ...base, verdict: "KEEP" as const, reason: `CPA ${fmtUsdc(c)} near the mission median${median ? ` ${fmtUsdc(median)}` : ""}` };
  });
}

/**
 * Move unspent budget from STOP/REDUCE experiments to SCALE experiments, proportional to
 * how much better the winners convert. Only unspent budget can move.
 */
export function planReallocation(perf: ExperimentPerformance[], findings: Finding[]): Reallocation[] {
  const byId = new Map(perf.map((p) => [p.experimentId, p]));
  const winners = findings.filter((f) => f.verdict === "SCALE").sort((a, b) => (a.cpaMicro ?? Infinity) - (b.cpaMicro ?? Infinity));
  const losers = findings.filter((f) => f.verdict === "STOP" || f.verdict === "REDUCE");
  if (!winners.length || !losers.length) return [];

  const moves: Reallocation[] = [];
  for (const loser of losers) {
    const p = byId.get(loser.experimentId)!;
    const unspent = Math.max(0, p.budgetMicro - p.spentMicro);
    const movable = loser.verdict === "STOP" ? unspent : Math.floor(unspent / 2);
    // Round down to whole cents so receipts read cleanly.
    let remaining = Math.floor(movable / 10_000) * 10_000;
    if (remaining <= 0) continue;
    const invTotal = winners.reduce((s, w) => s + 1 / (w.cpaMicro ?? 1), 0);
    winners.forEach((w, i) => {
      const share = i === winners.length - 1 ? remaining : Math.floor((movable * (1 / (w.cpaMicro ?? 1))) / invTotal / 10_000) * 10_000;
      const amt = Math.min(share, remaining);
      if (amt <= 0) return;
      remaining -= amt;
      moves.push({
        fromExperimentId: loser.experimentId,
        toExperimentId: w.experimentId,
        amountMicro: amt,
        amount: microToDecimal(amt),
        reason: `${loser.verdict === "STOP" ? "Stop" : "Reduce"} ${loser.label} (${loser.cpaMicro == null ? "no conversions" : `CPA ${fmtUsdc(loser.cpaMicro)}`}) → scale ${w.label} (CPA ${fmtUsdc(w.cpaMicro!)})`,
      });
    });
  }
  return moves;
}

/** Growth efficiency 0-100: goal attainment, cost efficiency vs plan, and experiment hit-rate. */
export function growthEfficiency(input: { goal: number; achieved: number; budgetMicro: number; spentMicro: number; experiments: number; successful: number }): number {
  const attainment = Math.min(1, input.achieved / Math.max(1, input.goal));
  const plannedCpa = input.budgetMicro / Math.max(1, input.goal);
  const actualCpa = input.achieved ? input.spentMicro / input.achieved : Infinity;
  const costEff = actualCpa === Infinity ? 0 : Math.min(1, plannedCpa / actualCpa);
  const hit = input.experiments ? input.successful / input.experiments : 0;
  return Math.round((attainment * 0.5 + costEff * 0.3 + hit * 0.2) * 100);
}
