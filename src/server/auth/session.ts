import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Stateless signed session cookie: base64url(payload).hmac-sha256. httpOnly, sameSite=lax,
 * secure in production. Secret from SESSION_SECRET; in development a random one is generated
 * and stored under .data/ so restarts keep you logged in.
 */
export const SESSION_COOKIE = "gt_session";
export const PROJECT_COOKIE = "gt_project";
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

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): { uid: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; exp: number };
    if (!uid || exp < Date.now() / 1000) return null;
    return { uid };
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
