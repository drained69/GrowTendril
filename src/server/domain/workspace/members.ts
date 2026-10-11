import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId, sha256 } from "@/server/lib/ids";
import { can, isRole, type Role } from "@/server/auth/access";

/**
 * Team membership. Invites are single-use links (token shown once, stored hashed) bound to a
 * verified email address. Membership changes serialize on the workspace row so its owner
 * invariant and the current actor's permissions are checked at the time of mutation.
 */

async function lockProject(db: DB, projectId: string) {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, projectId)).for("update");
  if (!project || project.dataMode !== "LIVE") throw new Error("Workspace not found");
  return project;
}

async function actorRole(db: DB, projectId: string, userId: string): Promise<Role> {
  const [member] = await db.select().from(s.memberships).where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.userId, userId)));
  if (!member || !isRole(member.role)) throw new Error("You are not a member of that workspace");
  return member.role;
}

async function transferPrimaryOwner(db: DB, project: typeof s.projects.$inferSelect, departingUserId: string) {
  if (project.ownerId !== departingUserId) return;
  const [next] = await db.select({ userId: s.memberships.userId }).from(s.memberships)
    .where(and(eq(s.memberships.projectId, project.id), eq(s.memberships.role, "owner")))
    .orderBy(s.memberships.createdAt).limit(1);
  if (!next) throw new Error("A workspace needs at least one owner");
  await db.update(s.projects).set({ ownerId: next.userId }).where(eq(s.projects.id, project.id));
}

export async function listMembers(db: DB, projectId: string) {
  return db
    .select({ userId: s.users.id, email: s.users.email, name: s.users.name, role: s.memberships.role, joinedAt: s.memberships.createdAt, lastLoginAt: s.users.lastLoginAt })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(eq(s.memberships.projectId, projectId))
    .orderBy(s.memberships.createdAt);
}

export async function listInvites(db: DB, projectId: string) {
  return db
    .select()
    .from(s.invites)
    .where(and(eq(s.invites.projectId, projectId), isNull(s.invites.acceptedAt), gt(s.invites.expiresAt, new Date())))
    .orderBy(desc(s.invites.createdAt));
}

export async function createInvite(db: DB, a: { projectId: string; email: string; role: Role; invitedBy: string; actorRole: Role }): Promise<{ token: string }> {
  const email = a.email.trim().toLowerCase();
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
  if (!isRole(a.role)) throw new Error("Unknown role");
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DB;
    await lockProject(scoped, a.projectId);
    const role = await actorRole(scoped, a.projectId, a.invitedBy);
    if (a.role === "owner" && role !== "owner") throw new Error("Only owners can invite owners");
    if (!can(role, "manage_members")) throw new Error("Your role cannot manage members");
    const [existing] = await tx.select({ id: s.users.id }).from(s.memberships).innerJoin(s.users, eq(s.memberships.userId, s.users.id)).where(and(eq(s.memberships.projectId, a.projectId), eq(s.users.email, email)));
    if (existing) throw new Error("That person is already a member");
    const token = randomBytes(24).toString("base64url");
    await tx.insert(s.invites).values({ id: newId(), projectId: a.projectId, email, role: a.role, tokenHash: sha256(token), invitedBy: a.invitedBy, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    await audit(scoped, { projectId: a.projectId, actorType: "user", actorId: a.invitedBy, action: "member.invite", target: email, data: { role: a.role } });
    return { token };
  });
}

export async function revokeInvite(db: DB, a: { projectId: string; inviteId: string; actorId: string }) {
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DB;
    await lockProject(scoped, a.projectId);
    if (!can(await actorRole(scoped, a.projectId, a.actorId), "manage_members")) throw new Error("Your role cannot manage members");
    await tx.delete(s.invites).where(and(eq(s.invites.id, a.inviteId), eq(s.invites.projectId, a.projectId)));
    await audit(scoped, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.invite_revoke", target: a.inviteId });
  });
}

export async function inviteByToken(db: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) return null;
  const [inv] = await db
    .select({ invite: s.invites, projectName: s.projects.name })
    .from(s.invites)
    .innerJoin(s.projects, eq(s.invites.projectId, s.projects.id))
    .where(eq(s.invites.tokenHash, sha256(token)));
  if (!inv || inv.invite.acceptedAt || inv.invite.expiresAt <= new Date()) return null;
  return inv;
}

export async function acceptInvite(db: DB, a: { token: string; userId: string; userEmail: string }): Promise<string> {
  const inv = await inviteByToken(db, a.token);
  if (!inv) throw new Error("This invite is invalid or has expired");
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DB;
    await lockProject(scoped, inv.invite.projectId);
    // Re-read under the same lock used by revocation and membership changes.
    const current = await inviteByToken(scoped, a.token);
    if (!current) throw new Error("This invite is invalid or has expired");
    const [user] = await tx.select().from(s.users).where(eq(s.users.id, a.userId));
    if (!user || user.isGuest || current.invite.email !== user.email.toLowerCase()) throw new Error(`This invite is for ${current.invite.email}. Sign in with that address to accept it.`);
    if (!user.emailVerifiedAt) throw new Error("Confirm your email before accepting an invite");
    if (!isRole(current.invite.role)) throw new Error("This invite has an invalid role");
    await tx.insert(s.memberships).values({ id: newId(), projectId: current.invite.projectId, userId: user.id, role: current.invite.role }).onConflictDoNothing();
    await tx.update(s.invites).set({ acceptedAt: new Date() }).where(eq(s.invites.id, current.invite.id));
    await audit(scoped, { projectId: current.invite.projectId, actorType: "user", actorId: user.id, action: "member.join", data: { role: current.invite.role } });
    return current.invite.projectId;
  });
}

async function ownerCount(db: DB, projectId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.memberships).where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.role, "owner")));
  return r?.n ?? 0;
}

export async function changeRole(db: DB, a: { projectId: string; userId: string; role: string; actorId: string; actorRole: Role }) {
  if (!isRole(a.role)) throw new Error("Unknown role");
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DB;
    const project = await lockProject(scoped, a.projectId);
    const role = await actorRole(scoped, a.projectId, a.actorId);
    const [m] = await tx.select().from(s.memberships).where(and(eq(s.memberships.projectId, a.projectId), eq(s.memberships.userId, a.userId)));
    if (!m) throw new Error("Not a member");
    if ((m.role === "owner" || a.role === "owner") && role !== "owner") throw new Error("Only owners can grant or change the owner role");
    if (!can(role, "manage_members")) throw new Error("Your role cannot manage members");
    if (m.role === "owner" && a.role !== "owner" && (await ownerCount(scoped, a.projectId)) <= 1) throw new Error("A workspace needs at least one owner");
    await tx.update(s.memberships).set({ role: a.role }).where(eq(s.memberships.id, m.id));
    if (a.role !== "owner") await transferPrimaryOwner(scoped, project, a.userId);
    await audit(scoped, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.role", target: a.userId, data: { from: m.role, to: a.role } });
  });
}

export async function removeMember(db: DB, a: { projectId: string; userId: string; actorId: string; actorRole: Role }) {
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DB;
    const project = await lockProject(scoped, a.projectId);
    const role = await actorRole(scoped, a.projectId, a.actorId);
    const [m] = await tx.select().from(s.memberships).where(and(eq(s.memberships.projectId, a.projectId), eq(s.memberships.userId, a.userId)));
    if (!m) return;
    if (m.role === "owner" && role !== "owner") throw new Error("Only owners can remove an owner");
    if (a.userId !== a.actorId && !can(role, "manage_members")) throw new Error("Your role cannot manage members");
    if (m.role === "owner" && (await ownerCount(scoped, a.projectId)) <= 1) throw new Error("A workspace needs at least one owner");
    await tx.delete(s.memberships).where(eq(s.memberships.id, m.id));
    await transferPrimaryOwner(scoped, project, a.userId);
    await audit(scoped, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.remove", target: a.userId });
  });
}
