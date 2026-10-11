import { describe, it, expect, beforeAll } from "vitest";
import type { DB } from "@/server/db/client";
import { can } from "@/server/auth/access";
import { decryptJson, encryptJson } from "@/server/security/secrets";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "11".repeat(32);

let db: DB;
let s: typeof import("@/server/db/schema");
let m: typeof import("@/server/domain/workspace/members");
let vault: typeof import("@/server/integrations/vault");

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  m = await import("@/server/domain/workspace/members");
  vault = await import("@/server/integrations/vault");
  await db.insert(s.users).values([
    { id: "u_owner", email: "owner@example.com", name: "Owner", passwordHash: "x" },
    { id: "u_bob", email: "bob@example.com", name: "Bob", passwordHash: "x" },
    { id: "u_eve", email: "eve@example.com", name: "Eve", passwordHash: "x" },
  ]);
  await db.insert(s.projects).values({ id: "p1", ownerId: "u_owner", name: "Acme", webhookSecret: "w" });
  await db.insert(s.memberships).values({ id: "m1", projectId: "p1", userId: "u_owner", role: "owner" });
});

describe("roles", () => {
  it("grants the documented permissions", () => {
    expect(can("viewer", "operate")).toBe(false);
    expect(can("member", "operate")).toBe(true);
    expect(can("member", "approve")).toBe(false);
    expect(can("admin", "manage_wallet")).toBe(true);
    expect(can("admin", "manage_workspace")).toBe(false);
    expect(can("owner", "manage_workspace")).toBe(true);
    expect(can("nonsense", "view")).toBe(false);
    expect(can(null, "view")).toBe(false);
  });
});

describe("secrets at rest", () => {
  it("round-trips and binds ciphertext to its context", () => {
    const blob = encryptJson({ token: "ghp_secret" }, "integration:p1:github");
    expect(blob).not.toContain("ghp_secret");
    expect(decryptJson(blob, "integration:p1:github")).toEqual({ token: "ghp_secret" });
    // Copying a credential to another workspace or provider must not decrypt.
    expect(() => decryptJson(blob, "integration:p2:github")).toThrow();
  });
});

describe("invites and membership", () => {
  it("accepts only for the invited email, once", async () => {
    const { token } = await m.createInvite(db, { projectId: "p1", email: "Bob@Example.com", role: "member", invitedBy: "u_owner", actorRole: "owner" });
    const [stored] = await db.select().from(s.invites);
    expect(stored.tokenHash).not.toBe(token); // only the hash is stored

    await expect(m.acceptInvite(db, { token, userId: "u_eve", userEmail: "eve@example.com" })).rejects.toThrow(/bob@example.com/);
    expect(await m.acceptInvite(db, { token, userId: "u_bob", userEmail: "bob@example.com" })).toBe("p1");
    expect(await m.inviteByToken(db, token)).toBeNull();
    const members = await m.listMembers(db, "p1");
    expect(members.map((x) => [x.email, x.role])).toEqual([
      ["owner@example.com", "owner"],
      ["bob@example.com", "member"],
    ]);
  });

  it("keeps at least one owner and blocks privilege escalation", async () => {
    await expect(m.createInvite(db, { projectId: "p1", email: "x@example.com", role: "owner", invitedBy: "u_bob", actorRole: "admin" })).rejects.toThrow(/owners/);
    await expect(m.changeRole(db, { projectId: "p1", userId: "u_bob", role: "owner", actorId: "u_bob", actorRole: "admin" })).rejects.toThrow(/owner/);
    await expect(m.changeRole(db, { projectId: "p1", userId: "u_owner", role: "admin", actorId: "u_owner", actorRole: "owner" })).rejects.toThrow(/at least one owner/);
    await expect(m.removeMember(db, { projectId: "p1", userId: "u_owner", actorId: "u_owner", actorRole: "owner" })).rejects.toThrow(/at least one owner/);
    await m.changeRole(db, { projectId: "p1", userId: "u_bob", role: "admin", actorId: "u_owner", actorRole: "owner" });
    expect((await m.listMembers(db, "p1")).find((x) => x.userId === "u_bob")?.role).toBe("admin");
  });
});

describe("integration credentials", () => {
  it("keeps a stored secret when its field is left blank, and refuses empty saves", async () => {
    const { providerById } = await import("@/server/integrations/providers");
    const reddit = providerById("reddit")!;
    expect(() => vault.mergeCredentialFields(reddit, { clientId: "", clientSecret: "", userAgent: "" }, { clientId: "id", clientSecret: "s3" })).toThrow(/Client ID is required|Nothing to save/);
    expect(vault.mergeCredentialFields(reddit, { clientId: "id2", clientSecret: "", userAgent: "" }, { clientSecret: "s3" })).toEqual({ secret: { clientSecret: "s3" }, config: { clientId: "id2" } });
    expect(() => vault.mergeCredentialFields(reddit, { clientId: "id2", clientSecret: "" }, null)).toThrow(/Client secret is required/);

    const github = providerById("github")!;
    expect(() => vault.mergeCredentialFields(github, { token: "" }, null)).toThrow(/Nothing to save/);
    await vault.saveIntegration(db, { projectId: "p1", providerId: "reddit", fields: { clientId: "cid", clientSecret: "first-secret" }, userId: "u_owner" });
    await vault.saveIntegration(db, { projectId: "p1", providerId: "reddit", fields: { clientId: "cid-renamed", clientSecret: "" }, userId: "u_owner" });
    const { creds, source } = await vault.resolveCredentials(db, "p1", reddit);
    expect(source).toBe("workspace");
    expect(creds).toMatchObject({ clientId: "cid-renamed", clientSecret: "first-secret" });
  });

  it("rejects RSS feeds on private addresses", async () => {
    await expect(vault.saveIntegration(db, { projectId: "p1", providerId: "rss", fields: { feeds: "http://169.254.169.254/latest/meta-data" }, userId: "u_owner" })).rejects.toThrow(/private|reserved/);
    await expect(vault.saveIntegration(db, { projectId: "p1", providerId: "rss", fields: { feeds: "file:///etc/passwd" }, userId: "u_owner" })).rejects.toThrow(/http/);
  });
});

describe("invite single use", () => {
  it("can't be accepted twice even by the right address", async () => {
    await db.insert(s.users).values({ id: "u_dan", email: "dan@example.com", name: "Dan", passwordHash: "x" });
    const { token } = await m.createInvite(db, { projectId: "p1", email: "dan@example.com", role: "viewer", invitedBy: "u_owner", actorRole: "owner" });
    const [a, b] = await Promise.allSettled([m.acceptInvite(db, { token, userId: "u_dan", userEmail: "dan@example.com" }), m.acceptInvite(db, { token, userId: "u_dan", userEmail: "dan@example.com" })]);
    expect([a.status, b.status].filter((x) => x === "fulfilled")).toHaveLength(1);
  });
});
