import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { signValue } from "@/server/auth/session";

/**
 * Sign in with Google (OpenID Connect, authorization code + PKCE). Needs GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET, with `${APP_URL}/api/auth/google/callback` registered as a redirect URI.
 */

export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID?.trim() && !!process.env.GOOGLE_CLIENT_SECRET?.trim();
export const OAUTH_COOKIE = "gos_oauth";

export interface OAuthState {
  state: string;
  verifier: string;
  next: string;
  invite: string | null;
  issuedAt: number;
}

/** The OAuth round-trip state, signed so nobody can plant their own in the cookie. */
export function packState(s: OAuthState): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${signValue(body)}`;
}

export function unpackState(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  const parts = raw.split(".");
  const [body, sig] = parts;
  if (parts.length !== 2 || !body || !sig || raw.length > 8192) return null;
  const expected = Buffer.from(signValue(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
    if (!state || typeof state.state !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(state.state) || typeof state.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state.verifier)) return null;
    if (typeof state.next !== "string" || (state.invite !== null && (typeof state.invite !== "string" || !/^[A-Za-z0-9_-]{10,80}$/.test(state.invite)))) return null;
    if (!Number.isFinite(state.issuedAt) || state.issuedAt > Date.now() || Date.now() - state.issuedAt >= 600_000) return null;
    return state;
  } catch {
    return null;
  }
}

export function newOAuthState(next: string, invite: string | null): OAuthState {
  return { state: randomBytes(16).toString("base64url"), verifier: randomBytes(32).toString("base64url"), next, invite, issuedAt: Date.now() };
}

export function authorizeUrl(st: OAuthState, redirectUri: string): string {
  const challenge = createHash("sha256").update(st.verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: st.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/**
 * Exchange the code for tokens. The ID token comes straight from Google's token endpoint over
 * TLS, so (per OpenID Connect) its claims are trusted after checking audience, issuer and expiry.
 */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleIdentity> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await r.json().catch(() => ({}))) as { id_token?: string; error_description?: string; error?: string };
  if (!r.ok || !body.id_token) throw new Error(body.error_description ?? body.error ?? `Google token exchange failed (HTTP ${r.status})`);
  return identityFromIdToken(body.id_token, process.env.GOOGLE_CLIENT_ID!.trim());
}

export function identityFromIdToken(idToken: string, clientId: string, nowS = Date.now() / 1000): GoogleIdentity {
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString()) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (claims.aud !== clientId) throw new Error("Google sign-in was issued for a different app");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("Unexpected sign-in issuer");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= nowS) throw new Error("Google sign-in expired — try again");
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(claims.email) || claims.email.length > 200) throw new Error("Google didn't share an email address");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("Your Google email isn't verified yet");
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: (typeof claims.name === "string" ? claims.name.trim().slice(0, 100) : "") || claims.email.split("@")[0] };
}
