import { and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { GoogleIdentity } from "@/server/auth/google";
import { newId } from "@/server/lib/ids";

/** Link only proven identities. An unverified signup must not retain credentials planted by somebody else. */
export async function googleAccount(db: DB, identity: GoogleIdentity): Promise<{ user: typeof s.users.$inferSelect; created: boolean }> {
  return db.transaction(async (tx) => {
    let [user] = await tx.select().from(s.users).where(eq(s.users.googleSub, identity.sub)).for("update");
    if (!user) [user] = await tx.select().from(s.users).where(eq(s.users.email, identity.email)).for("update");
    if (!user) {
      const [created] = await tx.insert(s.users).values({ id: newId(), email: identity.email, name: identity.name, passwordHash: null, googleSub: identity.sub, emailVerifiedAt: new Date() }).onConflictDoNothing().returning();
      if (created) return { user: created, created: true };
      // A concurrent sign-in may have created either unique identity while this request waited.
      [user] = await tx.select().from(s.users).where(eq(s.users.googleSub, identity.sub)).for("update");
      if (!user) [user] = await tx.select().from(s.users).where(eq(s.users.email, identity.email)).for("update");
    }
    if (!user || user.isGuest) throw new Error("Google sign-in could not link this account");
    if (user.googleSub && user.googleSub !== identity.sub) throw new Error("Google identity does not match this account");
    const unproven = !user.emailVerifiedAt;
    const [linked] = await tx.update(s.users).set({
      googleSub: identity.sub,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      // Nobody proved who chose this password or received those pre-verification sessions.
      ...(unproven ? { passwordHash: null, sessionVersion: sql`${s.users.sessionVersion} + 1` } : {}),
    }).where(eq(s.users.id, user.id)).returning();
    if (unproven) await tx.update(s.emailCodes).set({ consumedAt: new Date() }).where(and(eq(s.emailCodes.userId, user.id), isNull(s.emailCodes.consumedAt)));
    return { user: linked, created: false };
  });
}
