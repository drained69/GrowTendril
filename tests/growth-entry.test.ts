import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { nextStep } from "@/server/auth/next-step";
import { websiteSetupPath } from "@/lib/website-start";
import { nextGrowthStep, type GrowthStepState } from "@/lib/next-growth-step";
import { customerConversations } from "@/server/queries/customer-conversations";

process.env.PGLITE_DIR = "memory://";
process.env.DATABASE_URL = "";
let db: DB;
beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  await db.insert(client.schema.users).values({ id: "entry-user", email: "entry@example.test", name: "Entry" });
  const s = client.schema;
  await db.insert(s.projects).values([
    { id: "entry-project", ownerId: "entry-user", name: "Entry", webhookSecret: "entry" },
    { id: "other-project", ownerId: "entry-user", name: "Other", webhookSecret: "other" },
  ]);
  await db.insert(s.sources).values([
    { id: "entry-source", projectId: "entry-project", provider: "reddit", url: "https://example.test/source", dataMode: "LIVE" },
    { id: "other-source", projectId: "other-project", provider: "reddit", url: "https://example.test/other", dataMode: "LIVE" },
  ]);
  await db.insert(s.socialPosts).values([
    { id: "entry-post", projectId: "entry-project", sourceId: "entry-source", provider: "reddit", externalId: "entry-post", url: "https://example.test/post", authorHandle: "shopper", content: "Which shoes work for everyday walking?", publishedAt: new Date(), dataMode: "LIVE" },
    { id: "other-post", projectId: "other-project", sourceId: "other-source", provider: "reddit", externalId: "other-post", url: "https://example.test/private-workspace-post", authorHandle: "other-shopper", content: "Other workspace's captured evidence", publishedAt: new Date(), dataMode: "LIVE" },
  ]);
  const common = { type: "PERSON", title: "A recommendation request", recommendedAction: "Review and reply personally", confidence: 0.6, expectedValue: "MEDIUM", dataMode: "LIVE" as const };
  await db.insert(s.opportunities).values([
    { ...common, id: "entry-opportunity", projectId: "entry-project", number: 1, subjectKey: "post:entry-post" },
    { ...common, id: "cross-post-reference", projectId: "entry-project", number: 2, subjectKey: "post:other-post" },
    { ...common, id: "dismissed-person", projectId: "entry-project", number: 3, subjectKey: "dismissed", status: "dismissed" },
    { ...common, id: "other-opportunity", projectId: "other-project", number: 1, subjectKey: "post:other-post" },
  ]);
});

describe("consumer discovery source context", () => {
  it("brings individual buying signals into Customers with the original post", async () => {
    const rows = await customerConversations(db, "entry-project");
    expect(rows.find((r) => r.opportunity.id === "entry-opportunity")?.post).toMatchObject({ author: "shopper", url: "https://example.test/post", content: "Which shoes work for everyday walking?" });
    expect(rows.map((r) => r.opportunity.id)).not.toContain("dismissed-person");
  });
  it("does not expose another workspace's opportunities or posts through a subject reference", async () => {
    const rows = await customerConversations(db, "entry-project");
    expect(rows.map((r) => r.opportunity.id)).not.toContain("other-opportunity");
    expect(rows.find((r) => r.opportunity.id === "cross-post-reference")?.post).toBeNull();
  });
});

describe("website-to-workspace handoff", () => {
  it("preserves a public website through signup routing for a new account", async () => {
    const target = websiteSetupPath(" example.com/pricing?category=shoes ");
    const signup = new URL(`/signup?${new URLSearchParams({ next: target })}`, "https://growtendril.test");
    const afterVerification = await nextStep(db, "entry-user", null, signup.searchParams.get("next")!);
    expect(new URL(afterVerification, "https://growtendril.test").searchParams.get("website")).toBe("https://example.com/pricing?category=shoes");
    expect(afterVerification).toBe(target);
  });
  it("keeps new accounts in setup for unrelated or unsafe destinations", async () => {
    for (const path of ["/app/wallet", "/onboarding-other?website=x", "//evil.test", "/%2f%2fevil.test"]) expect(await nextStep(db, "entry-user", null, path)).toBe("/onboarding");
  });
  it("does not carry embedded credentials or executable URL schemes into signup", () => {
    for (const value of ["https://user:password@example.com", "javascript:alert(1)", "data:text/html,test", "", "https://"]) expect(() => websiteSetupPath(value)).toThrow();
  });
});

const ready: GrowthStepState = {
  hasProfile: true, hasMission: true, readySources: 2, scanStatus: null, hasScanned: false,
  creditMicro: 2_000_000, pendingApprovals: 0,
  permissions: { operate: true, approve: true, manageProfile: true, managePolicy: true, manageIntegrations: true, ownsCredit: true },
};

describe("next growth decision", () => {
  it("lets a ready workspace discover without requiring a payment wallet or website", () => {
    // Manual product profiles are supported; neither a site nor a wallet is a prerequisite.
    expect(nextGrowthStep(ready).kind).toBe("scan");
  });
  it("fixes missing sources before recommending a paid scan", () => {
    expect(nextGrowthStep({ ...ready, readySources: 0, creditMicro: 0 })).toMatchObject({ kind: "link", href: "/app/integrations" });
  });
  it("routes insufficient owner credit to billing, and member credit to the owner", () => {
    expect(nextGrowthStep({ ...ready, creditMicro: 1_999_999 })).toMatchObject({ kind: "link", href: "/billing" });
    expect(nextGrowthStep({ ...ready, creditMicro: 0, permissions: { ...ready.permissions, ownsCredit: false } })).toMatchObject({ kind: "link", href: "/app/team" });
  });
  it("allows reviewing existing opportunities even when service credit runs out", () => {
    expect(nextGrowthStep({ ...ready, creditMicro: 0, opportunityHref: "/app/opportunities/stored" })).toMatchObject({ kind: "link", href: "/app/opportunities/stored" });
  });
  it("does not suggest a duplicate scan or grant a viewer an operator action", () => {
    expect(nextGrowthStep({ ...ready, scanStatus: "running" })).toMatchObject({ kind: "link", href: "/app/runs" });
    expect(nextGrowthStep({ ...ready, permissions: { ...ready.permissions, operate: false, approve: false } })).toMatchObject({ kind: "link", href: "/app/plan" });
  });
  it("brings a pending money decision ahead of new research", () => {
    expect(nextGrowthStep({ ...ready, pendingApprovals: 1, scanStatus: "running" })).toMatchObject({ kind: "link", href: "/app/approvals", label: "Review requests" });
    expect(nextGrowthStep({ ...ready, pendingApprovals: 1, permissions: { ...ready.permissions, approve: false } })).toMatchObject({ label: "View requests" });
  });
});
