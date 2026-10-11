import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";

/** Keep post-auth destinations on this origin, including after URL/browser normalization. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/app";
  let pathname = value.split(/[?#]/, 1)[0];
  for (let i = 0; i < 4; i++) {
    if (pathname.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(pathname)) return "/app";
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return "/app"; }
    if (decoded === pathname) break;
    pathname = decoded;
  }
  if (pathname.startsWith("//") || /[\\\u0000-\u0020\u007f]|%[0-9a-f]{2}/i.test(pathname)) return "/app";
  const base = "https://growtendril.invalid";
  try { return new URL(value, base).origin === base ? value : "/app"; } catch { return "/app"; }
}

/**
 * Where a verified account goes after signing in: the workspace they were invited to, the page
 * they asked for, or setup. Setting up is free; services draw on prepaid credit.
 */
export async function nextStep(db: DB, userId: string, invitedProject: string | null, requested = "/app"): Promise<string> {
  if (invitedProject) return "/app";
  const destination = safeNext(requested);
  if (/^\/creator(?:\/invite\/[a-f0-9]{64})?$/.test(destination)) return destination;
  const [membership] = await db.select({ id: s.memberships.id }).from(s.memberships).innerJoin(s.projects, eq(s.memberships.projectId, s.projects.id)).where(and(eq(s.memberships.userId, userId), eq(s.projects.dataMode, "LIVE"))).limit(1);
  return membership ? safeNext(requested) : "/onboarding";
}
