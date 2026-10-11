import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Stateless signed session cookie: base64url(payload).hmac-sha256. httpOnly, sameSite=lax,
 * secure in production. Secret from SESSION_SECRET; in development a random one is generated
 * and stored under .data/ so restarts keep you logged in.
 */
export const SESSION_COOKIE = "gos_session";
export const PROJECT_COOKIE = "gos_project";
const MAX_AGE_S = 60 * 60 * 24 * 7;

let secret: Buffer | null = null;
function getSecret(): Buffer {
  if (secret) return secret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return (secret = Buffer.from(process.env.SESSION_SECRET));
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (≥32 chars) is required in production");
  const file = path.join(process.cwd(), ".data", "session-secret");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return (secret = Buffer.from(readFileSync(file, "utf8").trim()));
}

const sign = (data: string) => createHmac("sha256", getSecret()).update(data).digest("base64url");

/** `v` is the account's session version: bumping it (password reset, sign out everywhere) revokes older sessions. */
export function createSessionToken(userId: string, version = 0): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, v: version, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** HMAC with the session secret, for other short-lived signed values (OAuth state). */
export const signValue = (data: string) => sign(`value:${data}`);

export function verifySessionToken(token: string | undefined | null): { uid: string; v: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  const [payload, sig] = parts;
  if (parts.length !== 2 || !payload || !sig || token.length > 4096) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { uid, exp, v } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: unknown; exp: unknown; v?: unknown };
    if (typeof uid !== "string" || !uid || uid.length > 200 || typeof exp !== "number" || !Number.isFinite(exp) || exp <= Date.now() / 1000) return null;
    if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) return null;
    return { uid, v: v ?? 0 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};
