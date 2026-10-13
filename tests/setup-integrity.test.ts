import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import type { AnalysisResult } from "@/server/domain/intel/product-analyst";
import { createWorkspace, replaceIcps, startMission, policyValues } from "@/server/domain/workspace/setup";
process.env.PGLITE_DIR = "memory://";
let db: DB;
let s: typeof import("@/server/db/schema");
const analysis: AnalysisResult = {
  profile: { summary: "A coffee shop", category: "Coffee", audience: "consumers", targetUsers: [], competitors: [], valueProps: [], integrations: [], useCases: [], pricing: null, terminology: [], keywords: ["coffee"] },
  generatedBy: "heuristic", crawled: [], note: "Test fixture",
};
beforeAll(async () => {
  const client = await import("@/server/db/client"); db = await client.getDb(); s = client.schema;
  await db.insert(s.users).values({ id: "setup-owner", email: "setup@example.test", name: "Owner", emailVerifiedAt: new Date() });
});

describe("workspace and mission integrity", () => {
  it("rolls back the workspace and owner when profile creation fails", async () => {
    const invalid = { ...analysis, profile: { ...analysis.profile, summary: null } } as unknown as AnalysisResult;
    await expect(createWorkspace(db, { userId: "setup-owner", name: "Broken setup", description: "Coffee", onboardingStep: 2, analysis: invalid })).rejects.toThrow();
    expect(await db.select().from(s.projects).where(eq(s.projects.name, "Broken setup"))).toHaveLength(0);
    expect(await db.select().from(s.memberships)).toHaveLength(0);
  });

  it("preserves previous ICPs when replacement fails", async () => {
    const pid = await createWorkspace(db, { userId: "setup-owner", name: "ICP integrity", description: "Coffee", onboardingStep: 2, analysis });
    await replaceIcps(db, pid, [{ tier: "primary", title: "Home brewers", description: "Coffee lovers", companySize: null, segments: [], signals: [] }]);
    await expect(replaceIcps(db, pid, [{ tier: "primary", title: null as unknown as string, description: "Invalid", companySize: null, segments: [], signals: [] }])).rejects.toThrow();
    expect((await db.select().from(s.icps).where(eq(s.icps.projectId, pid))).map((i) => i.title)).toEqual(["Home brewers"]);
  });

  it("serializes concurrent missions and preserves every micro-USDC in budget allocation", async () => {
    const pid = await createWorkspace(db, { userId: "setup-owner", name: "Mission integrity", description: "Coffee", onboardingStep: 4, analysis });
    const create = () => startMission(db, { projectId: pid, templateKey: "find_buyers", goal: 10, days: 14, budget: "0.000007" });
    await Promise.all([create(), create()]);
    const active = await db.select().from(s.missions).where(and(eq(s.missions.projectId, pid), eq(s.missions.status, "active")));
    expect(active).toHaveLength(1);
    const buckets = await db.select().from(s.missionBudgets).where(eq(s.missionBudgets.missionId, active[0].id));
    expect(buckets.reduce((sum, b) => sum + b.allocatedMicro, 0)).toBe(active[0].budgetMicro);
    await expect(startMission(db, { projectId: pid, templateKey: "find_buyers", goal: 10, days: 14, budget: "-1" })).rejects.toThrow();
    expect(await db.select().from(s.missions).where(and(eq(s.missions.projectId, pid), eq(s.missions.status, "active")))).toHaveLength(1);
  });

  it("rejects invalid financial settings rather than storing negative/unsafe limits", () => {
    expect(() => policyValues({ dailySpend: "-1", hardCeiling: "10", autonomousLimit: "0" })).toThrow();
    expect(() => policyValues({ dailySpend: "9007199254740992", hardCeiling: "10", autonomousLimit: "0" })).toThrow();
    expect(() => policyValues({ dailySpend: "10", hardCeiling: "0", autonomousLimit: "0" })).toThrow(/positive per-payment ceiling/);
    expect(policyValues({ dailySpend: "100", hardCeiling: "50", autonomousLimit: "20" })).toMatchObject({ customPaymentCeilingEnabled: true, hardCeilingMicro: 50_000_000, maxTransactionMicro: 20_000_000 });
  });
});
