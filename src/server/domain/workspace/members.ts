import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId, sha256 } from "@/server/lib/ids";
import { isRole, type Role } from "@/server/auth/access";

/**
 * Team membership. Invites are single-use links (token shown once, stored hashed) for an email
 * address. There is no outbound email and addresses are not verified: whoever holds the link can
 * join by signing up with that address — the link itself is the credential, so share it privately.
 */

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
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
  if (a.role === "owner" && a.actorRole !== "owner") throw new Error("Only owners can invite owners");
  const [existing] = await db.select({ id: s.users.id }).from(s.memberships).innerJoin(s.users, eq(s.memberships.userId, s.users.id)).where(and(eq(s.memberships.projectId, a.projectId), eq(s.users.email, email)));
  if (existing) throw new Error("That person is already a member");
  const token = randomBytes(24).toString("base64url");
  await db.insert(s.invites).values({ id: newId(), projectId: a.projectId, email, role: a.role, tokenHash: sha256(token), invitedBy: a.invitedBy, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.invitedBy, action: "member.invite", target: email, data: { role: a.role } });
  return { token };
}

export async function revokeInvite(db: DB, a: { projectId: string; inviteId: string; actorId: string }) {
  await db.delete(s.invites).where(and(eq(s.invites.id, a.inviteId), eq(s.invites.projectId, a.projectId)));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.invite_revoke", target: a.inviteId });
}

export async function inviteByToken(db: DB, token: string) {
  const [inv] = await db
    .select({ invite: s.invites, projectName: s.projects.name })
    .from(s.invites)
    .innerJoin(s.projects, eq(s.invites.projectId, s.projects.id))
    .where(eq(s.invites.tokenHash, sha256(token)));
  if (!inv || inv.invite.acceptedAt || inv.invite.expiresAt < new Date()) return null;
  return inv;
}

export async function acceptInvite(db: DB, a: { token: string; userId: string; userEmail: string }): Promise<string> {
  const inv = await inviteByToken(db, a.token);
  if (!inv) throw new Error("This invite is invalid or has expired");
  if (inv.invite.email !== a.userEmail.toLowerCase()) throw new Error(`This invite is for ${inv.invite.email}. Sign in with that address to accept it.`);
  // Claim the invite first (single use, even under concurrent accepts), then add the membership.
  const claimed = await db.update(s.invites).set({ acceptedAt: new Date() }).where(and(eq(s.invites.id, inv.invite.id), isNull(s.invites.acceptedAt))).returning({ id: s.invites.id });
  if (!claimed.length) throw new Error("This invite has already been used");
  await db.insert(s.memberships).values({ id: newId(), projectId: inv.invite.projectId, userId: a.userId, role: inv.invite.role }).onConflictDoNothing();
  await audit(db, { projectId: inv.invite.projectId, actorType: "user", actorId: a.userId, action: "member.join", data: { role: inv.invite.role } });
  return inv.invite.projectId;
}

async function ownerCount(db: DB, projectId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.memberships).where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.role, "owner")));
  return r?.n ?? 0;
}

export async function changeRole(db: DB, a: { projectId: string; userId: string; role: string; actorId: string; actorRole: Role }) {
  if (!isRole(a.role)) throw new Error("Unknown role");
  const [m] = await db.select().from(s.memberships).where(and(eq(s.memberships.projectId, a.projectId), eq(s.memberships.userId, a.userId)));
  if (!m) throw new Error("Not a member");
  if ((m.role === "owner" || a.role === "owner") && a.actorRole !== "owner") throw new Error("Only owners can grant or change the owner role");
  if (m.role === "owner" && a.role !== "owner" && (await ownerCount(db, a.projectId)) <= 1) throw new Error("A workspace needs at least one owner");
  await db.update(s.memberships).set({ role: a.role }).where(eq(s.memberships.id, m.id));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.role", target: a.userId, data: { from: m.role, to: a.role } });
}

export async function removeMember(db: DB, a: { projectId: string; userId: string; actorId: string; actorRole: Role }) {
  const [m] = await db.select().from(s.memberships).where(and(eq(s.memberships.projectId, a.projectId), eq(s.memberships.userId, a.userId)));
  if (!m) return;
  if (m.role === "owner" && a.actorRole !== "owner") throw new Error("Only owners can remove an owner");
  if (m.role === "owner" && (await ownerCount(db, a.projectId)) <= 1) throw new Error("A workspace needs at least one owner");
  await db.delete(s.memberships).where(eq(s.memberships.id, m.id));
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.actorId, action: "member.remove", target: a.userId });
}
