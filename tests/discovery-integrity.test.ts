import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import type { FetchedPost } from "@/server/integrations/providers/types";
process.env.PGLITE_DIR = "memory://";
const fake = vi.hoisted(() => ({ search: vi.fn(), ready: true, audiences: undefined as string[] | undefined }));
vi.mock("@/server/integrations/vault", () => ({
  listConnections: async () => [],
  readyProviders: async () => fake.ready ? [{ provider: { id: "bluesky", name: "Bluesky", get audiences() { return fake.audiences; }, search: fake.search }, creds: {}, source: "keyless" }] : [],
}));
vi.mock("@/server/domain/intel/analyze", () => ({ analyzeProject: async () => ({ posts: 0, companies: 0, kols: 0, narratives: 0, issues: 0, mentions: 0, opportunities: 0 }), estimateKolCostMicro: () => 0 }));
vi.mock("@/server/domain/growth/creator-scout", () => ({ scoutCreators: async () => ({ candidates: 0, posts: 0, cache: new Map() }), enrichCreators: async () => 0 }));
vi.mock("@/server/domain/growth/creator-report", () => ({ latestCreatorReport: async () => null, buildCreatorReport: async () => ({ entries: [] }), saveCreatorReport: async () => {} }));
vi.mock("@/server/integrations/llm", () => ({ aiEnabled: () => false, aiName: () => "AI", aiStructured: async () => ({ data: null }) }));
import { runDiscovery } from "@/server/domain/intel/discovery";
import { ingestPosts } from "@/server/domain/intel/ingest";
import { buildGrowthPlan } from "@/server/domain/growth/plan";
import { startMission } from "@/server/domain/workspace/setup";
import { addCredit, balanceMicro } from "@/server/domain/billing";
let db: DB;
let s: typeof import("@/server/db/schema");
beforeAll(async () => {
  const client = await import("@/server/db/client"); db = await client.getDb(); s = client.schema;
  await db.insert(s.users).values({ id: "discovery-owner", email: "discovery@example.test", name: "Owner", emailVerifiedAt: new Date() });
  await db.insert(s.projects).values({ id: "discovery-project", ownerId: "discovery-owner", name: "Coffee", webhookSecret: "test", onboardingStep: 5 });
  await db.insert(s.productProfiles).values({ id: "discovery-profile", projectId: "discovery-project", summary: "Coffee", category: "Coffee", audience: "consumers", keywords: ["coffee"], generatedBy: "heuristic" });
});
beforeEach(() => { fake.search.mockReset(); fake.ready = true; fake.audiences = undefined; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("discovery integrity", () => {
  it("fails when every search errors and succeeds when a readable source legitimately returns no matches", async () => {
    fake.search.mockRejectedValue(new Error("Provider unavailable"));
    await expect(runDiscovery(db, "discovery-project", () => {})).rejects.toThrow(/refunded/);
    fake.search.mockResolvedValue([]);
    expect((await runDiscovery(db, "discovery-project", () => {})).fetched).toEqual({ bluesky: 0 });
  });

  it("refuses a paid scan with no eligible sources", async () => {
    fake.audiences = ["developers"];
    await expect(runDiscovery(db, "discovery-project", () => {})).rejects.toThrow(/No sources are ready/);
    expect(fake.search).not.toHaveBeenCalled();
  });

  it("refunds the real service charge and marks the cycle failed when all sources fail", async () => {
    vi.stubEnv("BILLING_ARC_ADDRESS", ""); vi.stubEnv("BILLING_DEV", "1");
    await addCredit(db, { userId: "discovery-owner", amountMicro: 5_000_000, ref: "discovery-funding" });
    const [job] = await db.insert(s.jobs).values({ id: "discovery-job", projectId: "discovery-project", kind: "cycle", trigger: "user", status: "running", attempts: 1 }).returning();
    fake.search.mockRejectedValue(new Error("Provider unavailable"));
    const { HANDLERS } = await import("@/server/jobs/handlers");
    await expect(HANDLERS.cycle(db, job)).rejects.toThrow(/refunded/);
    expect(await balanceMicro(db, "discovery-owner")).toBe(5_000_000);
    const ledger = await db.select().from(s.creditLedger).where(eq(s.creditLedger.ref, "job:discovery-job:1"));
    expect(ledger.map((entry) => entry.kind).sort()).toEqual(["charge", "refund"]);
    const runs = await db.select().from(s.agentRuns).where(eq(s.agentRuns.projectId, "discovery-project"));
    expect(runs.at(-1)?.status).toBe("failed");
  });

  it("counts new posts exactly once even when they are fetched again immediately", async () => {
    const post: FetchedPost = { externalId: "repeat-1", url: "https://bsky.app/profile/coffee.example/post/1", authorHandle: "coffee.example", content: "Coffee please", publishedAt: new Date(), engagement: { likes: 1 } };
    expect(await ingestPosts(db, "discovery-project", "bluesky", [post], "LIVE", { keywords: ["coffee"] })).toBe(1);
    expect(await ingestPosts(db, "discovery-project", "bluesky", [{ ...post, engagement: { likes: 2 } }], "LIVE", { keywords: ["coffee"] })).toBe(0);
    const rows = await db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, "discovery-project"), eq(s.socialPosts.externalId, "repeat-1")));
    expect(rows).toHaveLength(1); expect(rows[0].engagement.likes).toBe(2);
    expect(await ingestPosts(db, "discovery-project", "bluesky", [{ ...post, externalId: "invalid-date", publishedAt: new Date("invalid") }, { ...post, externalId: "unsafe-link", url: "javascript:alert(1)" }], "LIVE", { keywords: ["coffee"] })).toBe(0);
  });

  it("does not present a generic reward idea as collected market evidence", async () => {
    await startMission(db, { projectId: "discovery-project", templateKey: "find_buyers", goal: 10, days: 14, budget: "20" });
    const plan = await buildGrowthPlan(db, "discovery-project");
    expect(plan.tracks.find((track) => track.key === "bounties")?.items).toHaveLength(1);
    expect(plan.focus).toMatch(/hasn't found strong signals/);
    expect(plan.focus).not.toContain("strongest signals");
  });
});
