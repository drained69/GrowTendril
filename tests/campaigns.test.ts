import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { toMicro } from "@/lib/money";
import { capReward, detectDisclosure, planCampaign, qualityScore, validPostUrl } from "@/server/domain/growth/campaign-plan";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "22".repeat(32);

describe("campaign planner", () => {
  it("derives creators, ceilings and pay from budget and max cost per action", () => {
    const p = planCampaign({ budgetMicro: toMicro(300), maxCostPerActionMicro: toMicro(10), days: 14, postsPerCreator: 2 });
    expect(p.creators).toBe(10); // 300 / (3 × 10) = 10
    expect(p.creatorCapMicro).toBe(toMicro(30));
    expect(p.basePayMicro).toBeLessThanOrEqual(toMicro(10)); // never above one action's worth
    expect(p.creatorCapMicro * 0.25 + 1).toBeGreaterThan(p.postsPerCreator * (p.basePayMicro + p.discussionBonusCapMicro)); // fixed pay ≤ 25% of ceiling
    expect(p.actionBonusMicro).toBe(toMicro(8)); // 80% of the ceiling
    expect(p.fixedPoolMicro + p.actionPoolMicro).toBe(toMicro(300));
    expect(p.reasoning.length).toBeGreaterThan(5);
  });

  it("warns when the budget can't fund a meaningful test", () => {
    const p = planCampaign({ budgetMicro: toMicro(20), maxCostPerActionMicro: toMicro(10) });
    expect(p.creators).toBe(1);
    expect(p.warnings.join(" ")).toMatch(/fewer than 3 actions|5–10/);
  });

  it("caps rewards at the creator ceiling and the campaign budget", () => {
    expect(capReward(toMicro(10), { creatorEarnedMicro: toMicro(25), creatorCapMicro: toMicro(30), campaignEarnedMicro: 0, budgetMicro: toMicro(300) })).toEqual({ amountMicro: toMicro(5), capped: "creator" });
    expect(capReward(toMicro(10), { creatorEarnedMicro: 0, creatorCapMicro: toMicro(30), campaignEarnedMicro: toMicro(296), budgetMicro: toMicro(300) })).toEqual({ amountMicro: toMicro(4), capped: "budget" });
    expect(capReward(toMicro(10), { creatorEarnedMicro: toMicro(30), creatorCapMicro: toMicro(30), campaignEarnedMicro: 0, budgetMicro: toMicro(300) }).amountMicro).toBe(0);
  });

  it("scores the rubric and detects disclosure only when text is available", () => {
    expect(qualityScore({ relevance: 5, depth: 5, accuracy: 5 })).toBe(100);
    expect(qualityScore({ relevance: 3, depth: 3, accuracy: 3 })).toBe(60);
    expect(detectDisclosure("Trying the new SDK #ad")).toBe(true);
    expect(detectDisclosure("Paid partnership with Acme — thoughts below")).toBe(true);
    expect(detectDisclosure("I love this SDK")).toBe(false);
    expect(detectDisclosure(null)).toBeNull();
    expect(detectDisclosure("Thanks to @acme [sponsor]", "[sponsor]")).toBe(true);
  });

  it("validates post URLs against the creator's platform", () => {
    expect(validPostUrl("https://x.com/ada/status/1", "x")).toBeNull();
    expect(validPostUrl("https://youtube.com/watch?v=1", "x")).toMatch(/X/);
    expect(validPostUrl("http://x.com/ada/status/1", "x")).toMatch(/https/);
    expect(validPostUrl("https://myblog.dev/post", "blog")).toBeNull();
  });
});

describe("creator campaign lifecycle (real Postgres via PGlite)", () => {
  let db: DB;
  let s: typeof import("@/server/db/schema");
  let cc: typeof import("@/server/domain/growth/creator-campaigns");
  let attribution: typeof import("@/server/domain/growth/attribution");

  beforeAll(async () => {
    const client = await import("@/server/db/client");
    db = await client.getDb();
    s = client.schema;
    cc = await import("@/server/domain/growth/creator-campaigns");
    attribution = await import("@/server/domain/growth/attribution");
    await db.insert(s.users).values({ id: "u1", email: "founder@example.com", name: "Founder", passwordHash: "x" });
    await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Ledgerline", webhookSecret: "w", onboardingStep: 5 });
    await db.insert(s.memberships).values({ id: "m1", projectId: "p1", userId: "u1", role: "owner" });
    const { DEFAULT_POLICY } = await import("@/server/domain/agent/policy");
    await db.insert(s.policies).values({ id: "pol1", projectId: "p1", ...DEFAULT_POLICY });
    const now = Date.now();
    await db.insert(s.missions).values({
      id: "mis1",
      projectId: "p1",
      template: "first_100_devs",
      name: "First 50 developers",
      goalEvent: "sdk_key_created",
      goalDescription: "verified SDK users",
      goalTarget: 50,
      budgetMicro: toMicro(500),
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 30 * 86_400_000),
      status: "active",
      dataMode: "LIVE",
    } as typeof s.missions.$inferInsert);
  });

  it("runs create → join → accept → review → verified action → payout with every rule enforced", async () => {
    await expect(
      cc.createCampaign(db, { projectId: "p1", userId: "u1", name: "Too big", topic: "payments", topicTerms: [], brief: "x".repeat(30), destinationUrl: "https://ledgerline.dev", targetEvent: "sdk_key_created", maxCostPerActionMicro: toMicro(10), budgetMicro: toMicro(900), days: 14, postsPerCreator: 2, platforms: ["x"], disclosureText: "#ad" }),
    ).rejects.toThrow(/unreserved/);

    const c = await cc.createCampaign(db, { projectId: "p1", userId: "u1", name: "Stablecoin invoicing", topic: "stablecoin invoicing", topicTerms: ["usdc invoice"], brief: "Show how you accept USDC invoices with the SDK.", destinationUrl: "https://ledgerline.dev", targetEvent: "sdk_key_created", maxCostPerActionMicro: toMicro(10), budgetMicro: toMicro(300), days: 14, postsPerCreator: 2, platforms: ["x", "blog"], disclosureText: "#ad" });
    expect(c.maxCreators).toBe(10);
    const [exp] = await db.select().from(s.experiments).where(eq(s.experiments.id, c.experimentId));
    expect(exp.status).toBe("running");
    expect(exp.budgetMicro).toBe(toMicro(300));

    // Join requires both agreements, a valid payout address and an allowed platform.
    await expect(cc.joinCampaign(db, c.joinToken, { provider: "x", handle: "@Ada", payoutAddress: "0x1111111111111111111111111111111111111111", agreeRules: true, agreeDisclosure: false })).rejects.toThrow(/disclosure/);
    await expect(cc.joinCampaign(db, c.joinToken, { provider: "youtube", handle: "ada", payoutAddress: "0x1111111111111111111111111111111111111111", agreeRules: true, agreeDisclosure: true })).rejects.toThrow(/platform/);
    await expect(cc.joinCampaign(db, c.joinToken, { provider: "x", handle: "ada", payoutAddress: "0x000000000000000000000000000000000000dEaD", agreeRules: true, agreeDisclosure: true })).rejects.toThrow(/can't receive/);
    const { accessToken, participantId } = await cc.joinCampaign(db, c.joinToken, { provider: "x", handle: "@Ada", payoutAddress: "0x1111111111111111111111111111111111111111", agreeRules: true, agreeDisclosure: true });
    await expect(cc.joinCampaign(db, c.joinToken, { provider: "x", handle: "ada", payoutAddress: "0x1111111111111111111111111111111111111111", agreeRules: true, agreeDisclosure: true })).rejects.toThrow(/already applied/);

    // Applicants can't submit until accepted.
    await expect(cc.submitPost(db, accessToken, { url: "https://x.com/ada/status/1" })).rejects.toThrow(/accepts your application/);
    await cc.decideParticipant(db, { projectId: "p1", campaignId: c.id, participantId, accept: true, userId: "u1" });
    const [p] = await db.select().from(s.campaignParticipants).where(eq(s.campaignParticipants.id, participantId));
    expect(p.status).toBe("accepted");
    expect(p.handle).toBe("ada");
    const [link] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, p.trackingCampaignId!));
    expect(link.experimentId).toBe(c.experimentId);

    const post1 = await cc.submitPost(db, accessToken, { url: "https://x.com/ada/status/1" });
    const post2 = await cc.submitPost(db, accessToken, { url: "https://x.com/ada/status/2" });
    const post3 = await cc.submitPost(db, accessToken, { url: "https://x.com/ada/status/3" });
    await expect(cc.submitPost(db, accessToken, { url: "https://x.com/ada/status/1" })).rejects.toThrow(/already submitted/);
    await expect(cc.submitPost(db, accessToken, { url: "https://youtube.com/watch?v=1" })).rejects.toThrow(/X/);

    // Undisclosed paid posts can't be accepted; honest reviews of disclosed posts earn base pay + capped discussion bonus.
    const review = { relevance: 4, depth: 4, accuracy: 5, disclosure: true, discussion: 3, note: "Real questions answered in replies" };
    await expect(cc.reviewPost(db, { projectId: "p1", postId: post1, accept: true, review: { ...review, disclosure: false }, userId: "u1" })).rejects.toThrow(/disclose/);
    const r1 = await cc.reviewPost(db, { projectId: "p1", postId: post1, accept: true, review, userId: "u1" });
    expect(r1.score).toBe(87);
    expect(r1.rewards.map((r) => r.kind).sort()).toEqual(["discussion", "post"]);
    expect(r1.rewards.find((r) => r.kind === "post")!.amountMicro).toBe(c.basePayMicro);
    expect(r1.rewards.find((r) => r.kind === "discussion")!.amountMicro).toBe(c.discussionBonusCapMicro);
    await cc.reviewPost(db, { projectId: "p1", postId: post2, accept: true, review: { ...review, discussion: 0 }, userId: "u1" });
    const r3 = await cc.reviewPost(db, { projectId: "p1", postId: post3, accept: true, review: { ...review, discussion: 0 }, userId: "u1" });
    expect(r3.rewards).toHaveLength(0); // over the max posts per creator

    // Verified actions: only the target event, through this creator's link, one per visitor.
    await attribution.recordConversion(db, { projectId: "p1", eventType: "sdk_key_created", referralCode: link.referralCode, visitorId: "v1", idempotencyKey: "e1", source: "webhook", dataMode: "LIVE" });
    await attribution.recordConversion(db, { projectId: "p1", eventType: "sdk_key_created", referralCode: link.referralCode, visitorId: "v1", idempotencyKey: "e2", source: "webhook", dataMode: "LIVE" });
    await attribution.recordConversion(db, { projectId: "p1", eventType: "signup", referralCode: link.referralCode, visitorId: "v2", idempotencyKey: "e3", source: "webhook", dataMode: "LIVE" });
    await attribution.recordConversion(db, { projectId: "p1", eventType: "sdk_key_created", referralCode: link.referralCode, visitorId: "v3", idempotencyKey: "e4", source: "webhook", dataMode: "LIVE" });
    expect(await cc.syncActionRewards(db, c)).toBe(2);
    expect(await cc.syncActionRewards(db, c)).toBe(0); // idempotent

    let ledger = await cc.campaignLedger(db, c);
    const me = ledger.creators.find((x) => x.participant.id === participantId)!;
    const expected = 2 * c.basePayMicro + c.discussionBonusCapMicro + 2 * c.actionBonusMicro;
    expect(me.earnedMicro).toBe(expected);
    expect(me.actions).toBe(2);
    expect(me.acceptedPosts).toBe(3);
    expect(ledger.verifiedMicro).toBe(expected);
    expect(ledger.paidMicro).toBe(0);
    expect(ledger.reservedMicro).toBe(c.creatorCapMicro - expected);
    expect(ledger.availableMicro).toBe(c.budgetMicro - expected - ledger.reservedMicro);
    expect(me.lines.every((l) => l.reason.length > 10)).toBe(true);

    // Payout goes through the policy engine; creator payments need approval by default.
    const out = await cc.proposePayout(db, { projectId: "p1", campaignId: c.id, participantId, userId: "u1" });
    expect(out.amountMicro).toBe(expected);
    expect(["AWAITING_APPROVAL", "DENIED", "SIMULATED"]).toContain(out.state);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.decisionId, out.decisionId));
    expect(tx.recipient).toBe("0x1111111111111111111111111111111111111111");
    expect(tx.amountMicro).toBe(expected);
    ledger = await cc.campaignLedger(db, c);
    if (out.state === "AWAITING_APPROVAL") {
      expect(ledger.creators[0].inPayoutMicro).toBe(expected);
      await expect(cc.proposePayout(db, { projectId: "p1", campaignId: c.id, participantId, userId: "u1" })).rejects.toThrow(/Nothing earned/);
      // A locked post can't be re-reviewed while its reward is being paid.
      await expect(cc.reviewPost(db, { projectId: "p1", postId: post1, accept: false, review, userId: "u1" })).rejects.toThrow(/locked/);
    } else {
      // A denied payout returns the rewards to "earned" so they can be paid later.
      expect(ledger.creators[0].earnedMicro).toBe(expected);
    }
  });
});
