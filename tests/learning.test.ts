import { describe, it, expect } from "vitest";
import { evaluateExperiments, experimentOutcome, planReallocation, growthEfficiency, type ExperimentPerformance } from "../src/server/domain/growth/learning";
import { toMicro } from "../src/lib/money";

const exp = (id: string, spent: number, conv: number, budget = 150): ExperimentPerformance => ({
  experimentId: id,
  number: Number(id.slice(1)),
  title: id,
  channel: "kol",
  status: "running",
  budgetMicro: toMicro(budget),
  spentMicro: toMicro(spent),
  conversions: conv,
  visits: conv * 5,
  successTarget: 5,
  stopMaxCpaMicro: toMicro(30),
  stopAfterSpendMicro: toMicro(75),
});

describe("learning engine (spec example)", () => {
  // KOL A: 150 spent / 4 → 37.50 ; KOL B: 100 / 21 → 4.76 ; content: 31 / 14 → 2.21
  const perf = [exp("e1", 150, 4, 200), exp("e2", 100, 21, 150), exp("e3", 31, 14, 60)];
  const f = evaluateExperiments(perf);
  it("stops KOL A and scales the cheap channels", () => {
    expect(f.find((x) => x.experimentId === "e1")!.verdict).toBe("STOP");
    expect(f.find((x) => x.experimentId === "e3")!.verdict).toBe("SCALE");
    expect(f.find((x) => x.experimentId === "e1")!.cpaMicro).toBe(toMicro(37.5));
  });
  it("moves only unspent budget from losers to winners", () => {
    const moves = planReallocation(perf, f);
    const total = moves.filter((m) => m.fromExperimentId === "e1").reduce((s, m) => s + m.amountMicro, 0);
    expect(total).toBe(toMicro(50)); // 200 budget − 150 spent
    expect(moves.every((m) => m.toExperimentId !== "e1")).toBe(true);
  });
  it("computes growth efficiency", () => {
    expect(growthEfficiency({ goal: 100, achieved: 84, budgetMicro: toMicro(500), spentMicro: toMicro(327), experiments: 12, successful: 7 })).toBeGreaterThan(70);
  });
  it("respects a small experiment's stop threshold before the signal minimum", () => {
    const small = { ...exp("e4", 2.5, 0, 5), stopAfterSpendMicro: toMicro(2.5) };
    expect(evaluateExperiments([small])[0].verdict).toBe("STOP");
  });
  it("does not reallocate payments that are still committed or fund closed winners", () => {
    const held = perf.map((p) => p.experimentId === "e1" ? { ...p, committedMicro: toMicro(190) } : p);
    expect(planReallocation(held, f).reduce((n, m) => n + m.amountMicro, 0)).toBe(toMicro(10));
    expect(planReallocation(perf.map((p) => ({ ...p, status: "succeeded" })), f)).toEqual([]);
  });
  it("reports finite efficiency when conversions cost nothing", () => {
    expect(growthEfficiency({ goal: 1, achieved: 1, budgetMicro: 0, spentMicro: 0, experiments: 1, successful: 1 })).toBe(100);
  });
});

describe("experiment lifecycle", () => {
  const base = { experimentId: "e", number: 1, title: "T", channel: "content", status: "running", budgetMicro: 30_000_000, spentMicro: 0, conversions: 0, visits: 0, successTarget: 2, stopMaxCpaMicro: 72_000_000, stopAfterSpendMicro: 15_000_000, timeframeDays: 10 };
  const start = new Date("2026-01-01T00:00:00Z");
  it("succeeds when the target is reached, even without paid spend", () => {
    expect(experimentOutcome({ ...base, conversions: 3, startsAt: start }, start.getTime() + 86_400_000)).toMatchObject({ status: "succeeded" });
  });
  it("fails when the timeframe ends first, and stays open until then", () => {
    expect(experimentOutcome({ ...base, conversions: 1, startsAt: start }, start.getTime() + 5 * 86_400_000)).toBeNull();
    expect(experimentOutcome({ ...base, conversions: 1, startsAt: start }, start.getTime() + 11 * 86_400_000)).toMatchObject({ status: "failed" });
  });
  it("leaves experiments that aren't running alone", () => {
    expect(experimentOutcome({ ...base, status: "proposed", conversions: 9 }, Date.now())).toBeNull();
  });
});
