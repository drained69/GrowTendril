import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema as s } from "@/server/db/client";
import { PROJECT_COOKIE, SESSION_COOKIE, verifySessionToken } from "@/server/auth/session";
import { can, type Permission, type Role } from "@/server/auth/access";

export type CurrentUser = { id: string; email: string; name: string; isGuest: boolean; emailVerified: boolean; hasPassword: boolean; googleLinked: boolean };

export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const sess = verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!sess) return null;
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, sess.uid));
  // A session from before a password reset (or "sign out everywhere") no longer counts.
  if (!u || u.isGuest || u.sessionVersion !== sess.v) return null;
  return { id: u.id, email: u.email, name: u.name, isGuest: u.isGuest, emailVerified: !!u.emailVerifiedAt, hasPassword: !!u.passwordHash, googleLinked: !!u.googleSub };
}

/** Signed in, whether or not the email is verified yet (the verify page itself). */
export async function requireSignedIn(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Signed in with a verified email. Unverified accounts are sent to enter their code first. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await requireSignedIn();
  if (!u.emailVerified) redirect("/verify");
  return u;
}

/** Workspaces the user belongs to, with their role. */
export async function userProjects(userId: string) {
  const db = await getDb();
  return db
    .select({ id: s.projects.id, name: s.projects.name, dataMode: s.projects.dataMode, onboardingStep: s.projects.onboardingStep, role: s.memberships.role })
    .from(s.memberships)
    .innerJoin(s.projects, eq(s.memberships.projectId, s.projects.id))
    .where(and(eq(s.memberships.userId, userId), eq(s.projects.dataMode, "LIVE")))
    .orderBy(asc(s.projects.createdAt));
}

/** The workspace in scope. Always re-checked against membership — the cookie is only a preference. */
export async function currentProject(userId: string): Promise<{ project: typeof s.projects.$inferSelect; role: Role } | null> {
  const db = await getDb();
  const pref = (await cookies()).get(PROJECT_COOKIE)?.value;
  const rows = await db
    .select({ project: s.projects, role: s.memberships.role })
    .from(s.memberships)
    .innerJoin(s.projects, eq(s.memberships.projectId, s.projects.id))
    .where(pref ? and(eq(s.memberships.userId, userId), eq(s.projects.id, pref), eq(s.projects.dataMode, "LIVE")) : and(eq(s.memberships.userId, userId), eq(s.projects.dataMode, "LIVE")))
    .orderBy(asc(s.projects.createdAt))
    .limit(1);
  if (rows[0]) return { project: rows[0].project, role: rows[0].role as Role };
  if (pref) {
    const [first] = await db.select({ project: s.projects, role: s.memberships.role }).from(s.memberships).innerJoin(s.projects, eq(s.memberships.projectId, s.projects.id)).where(and(eq(s.memberships.userId, userId), eq(s.projects.dataMode, "LIVE"))).orderBy(asc(s.projects.createdAt)).limit(1);
    if (first) return { project: first.project, role: first.role as Role };
  }
  return null;
}

/** For /app pages: user + workspace (onboarded) + role, or redirect. */
export async function requireProject(permission: Permission = "view") {
  const user = await requireUser();
  const cur = await currentProject(user.id);
  if (!cur) redirect("/onboarding");
  const db = await getDb();
  if (cur.project.onboardingStep < 5) redirect("/onboarding");
  if (!can(cur.role, permission)) redirect("/app?denied=1");
  return { user, project: cur.project, role: cur.role, db };
}
