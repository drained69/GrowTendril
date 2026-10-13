import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const browser = vi.hoisted(() => ({ session: "", projectId: "actions-project" }));
const providers = vi.hoisted(() => ({ testIntegration: vi.fn(async () => ({ ok: true, message: "Connected" })), saveIntegration: vi.fn(), removeIntegration: vi.fn() }));
const recovery = vi.hoisted(() => ({ issueCode: vi.fn(async () => { throw new Error("provider unavailable"); }), consumeCode: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => ({ value: key === "gos_session" ? browser.session : browser.projectId }) }),
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.21" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (destination: string) => { throw Object.assign(new Error("redirect"), { destination }); } }));
vi.mock("@/server/integrations/vault", () => providers);
vi.mock("@/server/domain/auth/codes", () => ({ ...recovery, CodeError: class CodeError extends Error {} }));

let db: DB;
beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  const s = client.schema;
  await db.insert(s.users).values([
    { id: "actions-owner", email: "owner-actions@example.test", name: "Owner", emailVerifiedAt: new Date() },
    { id: "actions-viewer", email: "viewer-actions@example.test", name: "Viewer", emailVerifiedAt: new Date() },
  ]);
  await db.insert(s.projects).values({ id: browser.projectId, ownerId: "actions-owner", name: "Actions", webhookSecret: "secret", onboardingStep: 5 });
  await db.insert(s.memberships).values([
    { id: "actions-owner-membership", projectId: browser.projectId, userId: "actions-owner", role: "owner" },
    { id: "actions-viewer-membership", projectId: browser.projectId, userId: "actions-viewer", role: "viewer" },
  ]);
  const { DEFAULT_POLICY } = await import("@/server/domain/agent/policy");
  await db.insert(s.policies).values({ id: "actions-policy", projectId: browser.projectId, ...DEFAULT_POLICY, maxTransactionMicro: 500_000_000, hardCeilingMicro: 500_000_000 });
});

describe("real-budget spending settings", () => {
  const rules = (hardCeiling: string, autonomousLimit = "0") => {
    const form = new FormData();
    form.set("dailySpend", "500");
    form.set("hardCeiling", hardCeiling);
    form.set("autonomousLimit", autonomousLimit);
    return form;
  };

  it("keeps legacy ceilings until an authorized user explicitly saves new limits", async () => {
    const { createSessionToken } = await import("@/server/auth/session");
    const { updatePolicyAction } = await import("@/server/actions/workspace");
    const { loadPolicy } = await import("@/server/domain/agent/ledger");
    expect(await loadPolicy(db, browser.projectId)).toMatchObject({ hardCeilingMicro: 10_000_000, maxTransactionMicro: 10_000_000 });
    browser.session = createSessionToken("actions-viewer");
    expect((await updatePolicyAction(undefined, rules("250"))).ok).toBe(false);
    expect((await loadPolicy(db, browser.projectId)).customPaymentCeilingEnabled).toBe(false);
    browser.session = createSessionToken("actions-owner");
    expect(await updatePolicyAction(undefined, rules("250"))).toMatchObject({ ok: true, message: "Policy saved (v2)" });
    expect(await loadPolicy(db, browser.projectId)).toMatchObject({ customPaymentCeilingEnabled: true, hardCeilingMicro: 250_000_000, autonomyEnabled: false });
    const { schema: s } = await import("@/server/db/client");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "policy.update"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: "actions-owner", data: { hardCeilingMicro: 250_000_000, customPaymentCeilingEnabled: true } });
  });

  it("rejects invalid ceilings and autonomous limits without changing the saved policy", async () => {
    const { updatePolicyAction } = await import("@/server/actions/workspace");
    const { loadPolicy } = await import("@/server/domain/agent/ledger");
    const before = await loadPolicy(db, browser.projectId);
    for (const form of [rules("0"), rules("-1"), rules("9007199254740992"), rules("250", "251"), rules("250.0000001")]) {
      expect((await updatePolicyAction(undefined, form)).ok).toBe(false);
    }
    expect(await loadPolicy(db, browser.projectId)).toEqual(before);
  });
});

describe("integration action authorization", () => {
  it("blocks viewers from invoking stored provider credentials", async () => {
    const { createSessionToken } = await import("@/server/auth/session");
    const { testIntegrationAction } = await import("@/server/actions/integrations");
    browser.session = createSessionToken("actions-viewer");
    const result = await testIntegrationAction("github");
    expect(result.ok).toBe(false);
    expect(providers.testIntegration).not.toHaveBeenCalled();
    browser.session = createSessionToken("actions-owner");
    expect((await testIntegrationAction("github")).ok).toBe(true);
    expect(providers.testIntegration).toHaveBeenCalledOnce();
  });
});

describe("recovery response privacy", () => {
  it("keeps the reset redirect for existing and unknown accounts when email delivery fails", async () => {
    const { forgotPasswordAction } = await import("@/server/actions/auth");
    for (const email of ["owner-actions@example.test", "unknown@example.test"]) {
      const form = new FormData();
      form.set("email", email);
      await expect(forgotPasswordAction(undefined, form)).rejects.toMatchObject({ destination: `/reset?email=${encodeURIComponent(email)}` });
    }
    expect(recovery.issueCode).toHaveBeenCalledOnce();
  });
});

describe("workspace URL inputs", () => {
  it("rejects non-web protocols without storing them", async () => {
    const { updateWorkspaceAction } = await import("@/server/actions/workspace");
    const { createSessionToken } = await import("@/server/auth/session");
    browser.session = createSessionToken("actions-owner");
    for (const website of ["javascript:alert(1)", "ftp://example.test/product"]) {
      const form = new FormData();
      form.set("name", "Actions");
      form.set("website", website);
      expect((await updateWorkspaceAction(undefined, form)).ok).toBe(false);
    }
    const { schema: s } = await import("@/server/db/client");
    const { eq } = await import("drizzle-orm");
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, browser.projectId));
    expect(project.website).toBeNull();
  });
});
