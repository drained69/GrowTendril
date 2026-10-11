import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const mail = vi.hoisted(() => ({ codes: [] as string[] }));
const browser = vi.hoisted(() => ({ session: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => key === "gos_session" && browser.session ? { value: browser.session } : undefined }) }));
vi.mock("@/server/integrations/email", () => ({ sendEmail: async (_db: unknown, message: { text: string }) => {
  mail.codes.push(message.text.match(/\n\n(\d{6})\n\n/)![1]);
  return { delivered: true, mode: "resend" };
} }));

let db: DB;
let s: typeof import("@/server/db/schema");
let codes: typeof import("@/server/domain/auth/codes");
let members: typeof import("@/server/domain/workspace/members");
beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  codes = await import("@/server/domain/auth/codes");
  members = await import("@/server/domain/workspace/members");
  await db.insert(s.users).values([
    { id: "code-user", email: "code@example.test", name: "Code", emailVerifiedAt: new Date() },
    { id: "first-owner", email: "first@example.test", name: "First", emailVerifiedAt: new Date() },
    { id: "next-owner", email: "next@example.test", name: "Next", emailVerifiedAt: new Date() },
    { id: "viewer", email: "viewer@example.test", name: "Viewer", emailVerifiedAt: new Date() },
    { id: "invitee", email: "invitee@example.test", name: "Invitee", emailVerifiedAt: new Date() },
    { id: "unverified", email: "unverified@example.test", name: "Unverified" },
  ]);
});

let projectNumber = 0;
async function workspace() {
  const projectId = `secure-project-${++projectNumber}`;
  await db.insert(s.projects).values({ id: projectId, ownerId: "first-owner", name: "Secure", webhookSecret: "secret" });
  await db.insert(s.memberships).values([
    { id: `${projectId}-first`, projectId, userId: "first-owner", role: "owner" },
    { id: `${projectId}-next`, projectId, userId: "next-owner", role: "owner" },
    { id: `${projectId}-viewer`, projectId, userId: "viewer", role: "viewer" },
  ]);
  return projectId;
}

describe("email codes under concurrent requests", () => {
  const user = { id: "code-user", email: "code@example.test", name: "Code" };
  it("issues only one code during concurrent resends", async () => {
    const now = Date.UTC(2026, 0, 1);
    const results = await Promise.allSettled([codes.issueCode(db, user, "verify", now), codes.issueCode(db, user, "verify", now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(s.emailCodes).where(and(eq(s.emailCodes.userId, user.id), eq(s.emailCodes.purpose, "verify")))).toHaveLength(1);
  });
  it("allows one successful consumption when the same reset code arrives twice", async () => {
    const now = Date.UTC(2026, 0, 2);
    await codes.issueCode(db, user, "reset", now);
    const code = mail.codes.at(-1)!;
    const results = await Promise.allSettled([codes.consumeCode(db, user.id, "reset", code, now + 1_000), codes.consumeCode(db, user.id, "reset", code, now + 1_000)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("counts simultaneous wrong guesses and retires the code after five", async () => {
    const now = Date.UTC(2026, 0, 3);
    await codes.issueCode(db, user, "reset", now);
    const code = mail.codes.at(-1)!;
    const wrong = code === "123456" ? "654321" : "123456";
    await Promise.allSettled(Array.from({ length: 12 }, () => codes.consumeCode(db, user.id, "reset", wrong, now + 1_000)));
    const [stored] = await db.select().from(s.emailCodes).where(eq(s.emailCodes.userId, user.id)).orderBy(s.emailCodes.createdAt).offset(2);
    expect(stored.attempts).toBe(5);
    expect(stored.consumedAt).not.toBeNull();
    await expect(codes.consumeCode(db, user.id, "reset", code, now + 2_000)).rejects.toThrow(/No active code/);
  });
});

describe("membership authorization and ownership", () => {
  it("keeps an owner after concurrent self-demotions", async () => {
    const projectId = await workspace();
    const results = await Promise.allSettled(["first-owner", "next-owner"].map((userId) => members.changeRole(db, { projectId, userId, role: "admin", actorId: userId, actorRole: "owner" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await db.select().from(s.memberships).where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.role, "owner")));
    expect(owners).toHaveLength(1);
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
    expect(project.ownerId).toBe(owners[0].userId);
  });
  it("keeps an owner after concurrent departures", async () => {
    const projectId = await workspace();
    const results = await Promise.allSettled(["first-owner", "next-owner"].map((userId) => members.removeMember(db, { projectId, userId, actorId: userId, actorRole: "owner" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await members.listMembers(db, projectId)).filter((m) => m.role === "owner")).toHaveLength(1);
  });
  it("transfers the account charged for services when its owner leaves", async () => {
    const projectId = await workspace();
    await members.removeMember(db, { projectId, userId: "first-owner", actorId: "next-owner", actorRole: "owner" });
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
    expect(project.ownerId).toBe("next-owner");
    expect((await members.listMembers(db, projectId)).some((m) => m.userId === "first-owner")).toBe(false);
  });
  it("checks stored permissions instead of caller-supplied or stale roles", async () => {
    const projectId = await workspace();
    await expect(members.changeRole(db, { projectId, userId: "viewer", role: "owner", actorId: "viewer", actorRole: "owner" })).rejects.toThrow(/Only owners/);
    await expect(members.createInvite(db, { projectId, email: "other@example.test", role: "member", invitedBy: "viewer", actorRole: "owner" })).rejects.toThrow(/cannot manage members/);
    await expect(members.removeMember(db, { projectId, userId: "next-owner", actorId: "viewer", actorRole: "owner" })).rejects.toThrow(/Only owners/);
    await members.changeRole(db, { projectId, userId: "first-owner", role: "viewer", actorId: "next-owner", actorRole: "owner" });
    await expect(members.createInvite(db, { projectId, email: "other@example.test", role: "member", invitedBy: "first-owner", actorRole: "owner" })).rejects.toThrow(/cannot manage members/);
  });
});

describe("invite identity and single-use guarantees", () => {
  it("requires the actual account to own and verify the invited address", async () => {
    const projectId = await workspace();
    const { token } = await members.createInvite(db, { projectId, email: "unverified@example.test", role: "member", invitedBy: "first-owner", actorRole: "owner" });
    await expect(members.acceptInvite(db, { token, userId: "viewer", userEmail: "unverified@example.test" })).rejects.toThrow(/Sign in with that address/);
    await expect(members.acceptInvite(db, { token, userId: "unverified", userEmail: "unverified@example.test" })).rejects.toThrow(/Confirm your email/);
    expect(await members.inviteByToken(db, token)).not.toBeNull();
  });
  it("accepts a link once under concurrent requests", async () => {
    const projectId = await workspace();
    const { token } = await members.createInvite(db, { projectId, email: "invitee@example.test", role: "member", invitedBy: "first-owner", actorRole: "owner" });
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => members.acceptInvite(db, { token, userId: "invitee", userEmail: "invitee@example.test" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await members.listMembers(db, projectId)).filter((m) => m.userId === "invitee")).toHaveLength(1);
    expect(await members.inviteByToken(db, token)).toBeNull();
  });
});

describe("Google identity linking", () => {
  it("revokes the password and sessions planted on an unverified signup", async () => {
    const { hashPassword } = await import("@/server/auth/password");
    const { createSessionToken } = await import("@/server/auth/session");
    const { currentUser } = await import("@/server/auth/current");
    const { googleAccount } = await import("@/server/domain/auth/google-account");
    await db.insert(s.users).values({ id: "planted-user", email: "victim@example.test", name: "Planted", passwordHash: hashPassword("attacker-password"), sessionVersion: 2 });
    browser.session = createSessionToken("planted-user", 2);
    expect((await currentUser())?.emailVerified).toBe(false);
    const { user, created } = await googleAccount(db, { sub: "google-victim", email: "victim@example.test", name: "Victim" });
    expect(created).toBe(false);
    expect(user.passwordHash).toBeNull();
    expect(user.sessionVersion).toBe(3);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await currentUser()).toBeNull();
    browser.session = createSessionToken(user.id, user.sessionVersion);
    expect((await currentUser())?.emailVerified).toBe(true);
  });
  it("preserves credentials that a verified account owner established", async () => {
    const { googleAccount } = await import("@/server/domain/auth/google-account");
    await db.insert(s.users).values({ id: "verified-link-user", email: "verified@example.test", name: "Verified", passwordHash: "existing-hash", emailVerifiedAt: new Date(), sessionVersion: 5 });
    const { user } = await googleAccount(db, { sub: "google-verified", email: "verified@example.test", name: "Verified" });
    expect(user.passwordHash).toBe("existing-hash");
    expect(user.sessionVersion).toBe(5);
  });
  it("creates one account for concurrent sign-ins and rejects a mismatched Google subject", async () => {
    const { googleAccount } = await import("@/server/domain/auth/google-account");
    const identity = { sub: "google-new", email: "new-google@example.test", name: "New" };
    const accounts = await Promise.all([googleAccount(db, identity), googleAccount(db, identity)]);
    expect(accounts[0].user.id).toBe(accounts[1].user.id);
    expect(accounts.filter((a) => a.created)).toHaveLength(1);
    await expect(googleAccount(db, { ...identity, sub: "different-subject" })).rejects.toThrow(/does not match/);
  });
});
