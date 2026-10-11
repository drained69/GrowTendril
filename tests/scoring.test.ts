import { describe, it, expect } from "vitest";
import { scoreCompany } from "../src/server/domain/scoring/intent";
import { scoreKol } from "../src/server/domain/scoring/kol";
import { classifySignals } from "../src/server/domain/intel/signals";
import { clusterNarratives } from "../src/server/domain/intel/narratives";
import { analyzeMention, clusterIssues } from "../src/server/domain/intel/mentions";
import { evaluateInformationValue } from "../src/server/domain/agent/information-value";
import { toMicro, microToDecimal, fmtUsdc } from "../src/lib/money";
import { DAY_MS } from "../src/lib/time";

const NOW = Date.UTC(2026, 9, 3);
const d = (days: number) => new Date(NOW - days * DAY_MS);

describe("signal classifier", () => {
  it("detects recommendation requests and competitor usage", () => {
    const s = classifySignals("Can anyone recommend an API for agent payments? We're using Stripe today.", { competitors: ["Stripe"] });
    expect(s[0].type).toBe("recommendation_request");
    expect(s.map((x) => x.type)).toContain("competitor_usage");
  });
  it("falls back to mention", () => {
    expect(classifySignals("x402 is neat").map((s) => s.type)).toEqual(["mention"]);
  });
});

describe("company scoring", () => {
  const ctx = { keywords: ["x402", "agent payments", "stablecoin"], icpTerms: ["developer", "infrastructure"], now: NOW };
  it("rewards fresh, diverse, verified evidence", () => {
    const base = [
      { signalType: "initiative" as const, observedAt: d(6), sourceUrl: "https://a", provider: "hackernews", excerpt: "We're building agent payments with stablecoin rails", classifiedBy: "rule" },
      { signalType: "hiring" as const, observedAt: d(3), sourceUrl: "https://b", provider: "github", excerpt: "Hiring infrastructure developer for x402", classifiedBy: "rule" },
    ];
    const a = scoreCompany(base, ctx);
    const b = scoreCompany([...base, { signalType: "x402_enrichment" as const, observedAt: d(0), sourceUrl: "https://c", provider: "x402", excerpt: "Verified: series A, hiring 2 smart contract engineers", classifiedBy: "x402" }], ctx);
    expect(b.evidenceQuality.score).toBeGreaterThan(a.evidenceQuality.score);
    expect(b.confidence).toBeGreaterThan(a.confidence);
    expect(a.overall).toBeGreaterThan(0);
    expect(a.productFit.reasons[0]).toMatch(/x402|agent payments|stablecoin/);
  });
  it("old evidence scores lower timing", () => {
    const e = (age: number) => [{ signalType: "launch" as const, observedAt: d(age), sourceUrl: "u", provider: "github", excerpt: "x402", classifiedBy: "rule" }];
    expect(scoreCompany(e(1), ctx).timing.score).toBeGreaterThan(scoreCompany(e(30), ctx).timing.score);
  });
});

describe("KOL scoring", () => {
  const ctx = { keywords: ["x402", "agent payments"], icpTerms: ["developer"], productName: "Relay", competitors: ["Stripe"], narrativeTerms: ["x402"], now: NOW, devAudience: true };
  it("does not reward follower count over relevance", () => {
    const focused = scoreKol(
      [1, 2, 3].map((i) => ({ content: `x402 agent payments deep dive for developer ${i}`, publishedAt: d(i), provider: "youtube", engagement: { likes: 300, comments: 60 } })),
      { ...ctx, followers: 8_000 },
    );
    const famous = scoreKol(
      [1, 2, 3].map((i) => ({ content: `market update ${i} 100x moon`, publishedAt: d(i), provider: "x", engagement: { likes: 400, comments: 5 } })),
      { ...ctx, followers: 900_000 },
    );
    expect(focused.overall).toBeGreaterThan(famous.overall);
    expect(famous.authenticity.score).toBeLessThan(focused.authenticity.score);
  });
});

describe("narratives", () => {
  it("detects an accelerating narrative", () => {
    const posts = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, text: "x402 agent payments are taking off", publishedAt: d(i % 6), authorHandle: `a${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, text: "x402 agent payments idea", publishedAt: d(8 + i), authorHandle: `b${i}` })),
    ];
    const c = clusterNarratives(posts, { keywords: ["x402"], now: NOW });
    expect(c[0].volume7d).toBe(8);
    expect(c[0].volumePrev7d).toBe(4);
    expect(c[0].status).toBe("ACCELERATING");
    expect(c[0].velocityPct).toBe(100);
  });
});

describe("mentions", () => {
  it("clusters a fast-growing issue as acquisition-blocking", () => {
    const a = analyzeMention("Wallet onboarding is so confusing, stuck on connect wallet again");
    expect(a.sentiment).toBe("negative");
    expect(a.issueKey).toBe("wallet-onboarding");
    const ms = [...Array.from({ length: 6 }, () => ({ issueKey: "wallet-onboarding", publishedAt: d(2) })), ...Array.from({ length: 2 }, () => ({ issueKey: "wallet-onboarding", publishedAt: d(10) }))];
    const c = clusterIssues(ms, NOW);
    expect(c[0].changePct).toBe(200);
    expect(c[0].blocksAcquisition).toBe(true);
  });
});

describe("information value", () => {
  it("buys a 0.01 USDC lookup that can change a 75 USDC decision", () => {
    const r = evaluateInformationValue({ confidence: 0.67, stakeMicro: toMicro(75), priceMicro: toMicro(0.01), expectedLift: 0.2, reliability: 0.8, maxPerCallMicro: toMicro(1) });
    expect(r.buy).toBe(true);
    expect(r.expectedValue).toBe("high");
  });
  it("does not buy when already confident", () => {
    const r = evaluateInformationValue({ confidence: 0.92, stakeMicro: toMicro(75), priceMicro: toMicro(0.5), expectedLift: 0.2, reliability: 0.8, maxPerCallMicro: toMicro(1) });
    expect(r.buy).toBe(false);
  });
});

describe("money", () => {
  it("round-trips micro-USDC without float drift", () => {
    expect(toMicro("0.01")).toBe(10_000);
    expect(toMicro("150")).toBe(150_000_000);
    expect(microToDecimal(toMicro("3.89"))).toBe("3.89");
    expect(microToDecimal(1)).toBe("0.000001");
    expect(fmtUsdc(1_000)).toBe("0.001 USDC");
  });
});

describe("mission budget availability", () => {
  it("subtracts spent, awaiting approval and open-experiment reservations without double counting", async () => {
    const { budgetAvailability } = await import("../src/server/queries/missions");
    const b = budgetAvailability({
      budgetMicro: 1_000,
      spentMicro: 100,
      awaitingApprovalMicro: 150, // 50 inside exp a's reservation, 100 standalone
      openExperiments: [
        { id: "a", budgetMicro: 300, spentMicro: 100 },
        { id: "b", budgetMicro: 100, spentMicro: 150 },
      ],
      awaitingByExperiment: { a: 50 },
    });
    expect(b.reserved).toBe(200);
    expect(b.awaitingApproval).toBe(100);
    expect(b.committed).toBe(300);
    expect(b.available).toBe(600);
  });
  it("never goes negative", async () => {
    const { budgetAvailability } = await import("../src/server/queries/missions");
    expect(budgetAvailability({ budgetMicro: 100, spentMicro: 90, awaitingApprovalMicro: 50, openExperiments: [], awaitingByExperiment: {} }).available).toBe(0);
  });
});
