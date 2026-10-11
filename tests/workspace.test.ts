import { describe, it, expect, beforeAll, vi } from "vitest";
import type { DB } from "@/server/db/client";
import { can } from "@/server/auth/access";
import { decryptJson, encryptJson } from "@/server/security/secrets";

process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY = "11".repeat(32);

let db: DB;
let s: typeof import("@/server/db/schema");
let m: typeof import("@/server/domain/workspace/members");

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  m = await import("@/server/domain/workspace/members");
  await db.insert(s.users).values([
    { id: "u_owner", email: "owner@example.com", name: "Owner", passwordHash: "x", emailVerifiedAt: new Date() },
    { id: "u_bob", email: "bob@example.com", name: "Bob", passwordHash: "x", emailVerifiedAt: new Date() },
    { id: "u_eve", email: "eve@example.com", name: "Eve", passwordHash: "x", emailVerifiedAt: new Date() },
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

describe("provider lookup", () => {
  it("loads workspace connections once for listing and discovery", async () => {
    const { listConnections, readyProviders } = await import("@/server/integrations/vault");
    const select = vi.spyOn(db, "select");
    try {
      const connections = await listConnections(db, "p1");
      expect(connections.length).toBeGreaterThan(1);
      expect(select).toHaveBeenCalledTimes(1);

      select.mockClear();
      const ready = await readyProviders(db, "p1");
      expect(ready.map((r) => r.provider.id)).toEqual(connections.filter((c) => c.ready).map((c) => c.provider.id));
      expect(select).toHaveBeenCalledTimes(1);
    } finally {
      select.mockRestore();
    }
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
