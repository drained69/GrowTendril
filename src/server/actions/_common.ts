import { cookies, headers } from "next/headers";
import { getDb } from "@/server/db/client";
import { currentProject, currentUser } from "@/server/auth/current";
import { can, type Permission } from "@/server/auth/access";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { rateLimit, clientIp } from "@/server/security/ratelimit";
import { ZodError } from "zod";

/** Uniform result for server actions consumed by client components. */
export type ActionResult<T = unknown> = { ok: true; data?: T; log?: { agent: string; message: string }[]; message?: string } | { ok: false; error: string; code?: "INSUFFICIENT_CREDIT"; nextHref?: "/billing" | "/app/team" };

export class ActionError extends Error {}

/** Every workspace action starts here: signed-in user, current workspace, and the permission it needs. */
export async function guard(permission: Permission) {
  const user = await currentUser();
  if (!user) throw new ActionError("You are signed out — sign in again.");
  if (!user.emailVerified) throw new ActionError("Confirm your email first — enter the code we sent you.");
  const cur = await currentProject(user.id);
  if (!cur) throw new ActionError("No workspace selected.");
  if (!can(cur.role, permission)) throw new ActionError(`Your role (${cur.role}) cannot do this.`);
  const db = await getDb();
  return { user, project: cur.project, role: cur.role, db };
}

export async function limited(key: string, capacity = 10, refillPerSec = 0.2) {
  const ip = clientIp(await headers());
  const r = rateLimit(`${key}:${ip}`, { capacity, refillPerSec });
  if (!r.ok) throw new ActionError(`Too many requests — retry in ${r.retryAfter}s.`);
}

export function fail(e: unknown): ActionResult<never> {
  const zod = e instanceof ZodError ? e.issues[0] : null;
  // Messages written for people ("Enter a USDC amount") stand alone; terse ones get the field name.
  const human = !!zod && /^[A-Z]/.test(zod.message) && zod.message.length > 15;
  if (zod) return { ok: false, error: human ? zod.message : `${zod.path.join(".") || "input"}: ${zod.message}` };
  if (!(e instanceof Error)) return { ok: false, error: "Something went wrong. Please try again." };
  // Circle rejecting the platform's credentials is an operator problem, not something the user can fix.
  const circle = e as { isAxiosError?: boolean; response?: { status?: number }; config?: { baseURL?: string; url?: string } };
  if (circle.isAxiosError && [401, 403].includes(circle.response?.status ?? 0) && /circle\.com/.test(`${circle.config?.baseURL ?? ""}${circle.config?.url ?? ""}`)) {
    return { ok: false, error: "Circle rejected this deployment's wallet credentials, so wallets and payments are paused. Nothing was sent. The operator needs to update CIRCLE_API_KEY." };
  }
  // Database/SDK diagnostics can contain SQL parameters, keys and account details.
  const infrastructure = !(e instanceof ActionError) && (e.name === "DrizzleQueryError" || e instanceof TypeError || e instanceof SyntaxError ||
    ("code" in e && typeof e.code === "string" && /^(?:[0-9A-Z]{5}|E[A-Z_]+)$/.test(e.code)) ||
    /^(?:Failed query:|query:|params:)|\b(?:postgres(?:ql)?:\/\/|Bearer\s|sk-ant-|AIza|api[_-]?key[=:])/i.test(e.message));
  return { ok: false, error: infrastructure ? "Couldn't complete this request. Please try again or contact support if it continues." : e.message.slice(0, 500) || "Something went wrong. Please try again." };
}

export async function startSession(userId: string, sessionVersion = 0) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId, sessionVersion), sessionCookieOptions);
}

export type LogLine = { agent: string; message: string };
export function collector() {
  const log: LogLine[] = [];
  return { log, push: (agent: string, message: string) => log.push({ agent, message }) };
}
