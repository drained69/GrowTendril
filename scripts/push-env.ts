/**
 * Upload non-empty values from .env to the Railway production service.
 *
 *   npm run env:push              upload, then trigger one redeploy
 *   npm run env:push -- --dry-run show what would be uploaded
 *   npm run env:push -- --skip=BILLING_ARC_ADDRESS   keep listed keys local (here: billing stays off)
 *
 * Values travel over stdin to the Railway CLI, so they never appear in argv, shell history,
 * or this script's output. Core secrets that Railway already has are skipped.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const SERVICE = "growthos";
const ENVIRONMENT = "production";
const dryRun = process.argv.includes("--dry-run");
// Changing these on a live deployment breaks stored data or sessions, so never overwrite them.
const KEEP_IF_SET = new Set(["APP_URL", "DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY"]);
// Left over from subscription plans; prices are now fixed per service in src/lib/services.ts.
const OBSOLETE = new Set(["BILLING_PRICE_STARTER_USDC", "BILLING_PRICE_GROWTH_USDC"]);

const checks: Record<string, (v: string) => string | null> = {
  CIRCLE_API_KEY: (v) =>
    v.startsWith("TEST_API_KEY:") ? "is a testnet key; Arc mainnet needs a production key"
    : !v.startsWith("LIVE_API_KEY:") || v.split(":").length !== 3 ? "is incomplete; expected LIVE_API_KEY:<id>:<secret>"
    : null,
  CIRCLE_ENTITY_SECRET: (v) => (/^[0-9a-f]{64}$/i.test(v) ? null : "must be 64 hex characters"),
  ENCRYPTION_KEY: (v) => (/^[0-9a-f]{64}$/i.test(v) || Buffer.from(v, "base64").length === 32 ? null : "must be 32 bytes (64 hex chars or base64)"),
  SESSION_SECRET: (v) => (v.length >= 32 ? null : "must be at least 32 characters"),
  APP_URL: (v) => (/^https:\/\//.test(v) ? null : "must start with https://"),
  ANTHROPIC_API_KEY: (v) => (v.startsWith("sk-ant-") ? null : "does not look like an Anthropic key"),
  RESEND_API_KEY: (v) => (v.startsWith("re_") ? null : "does not look like a Resend key (re_…)"),
  EMAIL_FROM: (v) => (/^(.+<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(v) ? null : "must be an address like: GrowTendril <hello@growtendril.xyz>"),
  GOOGLE_CLIENT_ID: (v) => (v.endsWith(".apps.googleusercontent.com") ? null : "should end with .apps.googleusercontent.com"),
  BILLING_ARC_ADDRESS: (v) => (/^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/i.test(v) ? null : "must be an Arc (EVM) address: 0x followed by 40 hex characters"),
};

/** Read-only calls that catch keys which look right but fail in production. */
async function liveChecks(): Promise<string[]> {
  const out: string[] = [];
  const gemini = local.get("GEMINI_API_KEY");
  if (gemini) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": gemini }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (r && !r.ok) out.push(`GEMINI_API_KEY was rejected (HTTP ${r.status}) — create one at aistudio.google.com/apikey`);
  }
  const anthropic = local.get("ANTHROPIC_API_KEY");
  // While Gemini is the provider, Claude is never called, so its key can't block a deploy.
  const claudeInUse = !gemini || local.get("LLM_PROVIDER")?.toLowerCase() === "claude";
  if (anthropic && !claudeInUse) console.warn("note  ANTHROPIC_API_KEY is uploaded but unused while GEMINI_API_KEY is set");
  if (anthropic && claudeInUse) {
    const workspace = local.get("ANTHROPIC_WORKSPACE_ID") ?? remote.ANTHROPIC_WORKSPACE_ID ?? undefined;
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01", ...(workspace ? { "anthropic-workspace-id": workspace } : {}) },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    const body = r && !r.ok ? ((await r.json().catch(() => ({}))) as { error?: { message?: string } }) : null;
    if (r && !r.ok)
      out.push(/workspace/i.test(body?.error?.message ?? "") ? "ANTHROPIC_API_KEY isn't scoped to a workspace: set ANTHROPIC_WORKSPACE_ID or create the key inside a workspace" : `ANTHROPIC_API_KEY was rejected (HTTP ${r.status})`);
  }
  const circle = local.get("CIRCLE_API_KEY");
  if (circle?.startsWith("LIVE_API_KEY:")) {
    const r = await fetch("https://api.circle.com/v1/w3s/config/entity/publicKey", { headers: { Authorization: `Bearer ${circle}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (r && !r.ok) console.warn(`warn  CIRCLE_API_KEY can't use Circle Wallets yet (HTTP ${r.status}): creator payouts stay off until Circle enables Wallets for this key`);
  }
  const googleId = local.get("GOOGLE_CLIENT_ID");
  const appUrl = local.get("APP_URL") ?? remote.APP_URL ?? undefined;
  if (googleId && appUrl) {
    const redirect = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
    const r = await fetch(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleId)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=openid`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const authError = r?.headers.get("location")?.match(/authError=([^&]+)/)?.[1];
    const reason = authError ? Buffer.from(decodeURIComponent(authError), "base64").toString("latin1").match(/redirect_uri_mismatch|invalid_client|deleted_client/)?.[0] : undefined;
    if (reason) out.push(`Google sign-in: ${reason} — add ${redirect} under Authorized redirect URIs for this OAuth client`);
  }
  return out;
}

function railway(args: string[], input?: string) {
  return spawnSync("npx", ["railway", ...args, "--service", SERVICE, "--environment", ENVIRONMENT], { input, encoding: "utf8" });
}

const local = new Map<string, string>();
for (const line of readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  const value = m?.[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  if (m && value) local.set(m[1], value);
}

for (const k of process.argv.find((a) => a.startsWith("--skip="))?.slice(7).split(",") ?? []) if (local.delete(k.trim())) console.log(`skip  ${k.trim()} (--skip)`);

const listed = railway(["variable", "list", "--json"]);
if (listed.status !== 0) {
  console.error(`Could not read Railway variables. Is the CLI logged in and linked?\n${listed.stderr}`);
  process.exit(1);
}
const remote = JSON.parse(listed.stdout) as Record<string, string | null>;

const errors: string[] = [];
const toSet: string[] = [];
for (const [key, value] of local) {
  if (OBSOLETE.has(key)) {
    console.log(`skip  ${key} (no longer used: each service has a fixed price)`);
    continue;
  }
  if (KEEP_IF_SET.has(key) && remote[key] !== undefined) {
    console.log(`skip  ${key} (already set on Railway; not overwritten)`);
    continue;
  }
  const problem = checks[key]?.(value);
  if (problem) errors.push(`${key} ${problem}`);
  else toSet.push(key);
}
const value = (k: string) => local.get(k) ?? remote[k] ?? undefined;
// Half-configured email blocks every signup in production, so it is an error, not a warning.
if (!!value("RESEND_API_KEY") !== !!value("EMAIL_FROM")) errors.push("RESEND_API_KEY and EMAIL_FROM must be set together (EMAIL_FROM must use a domain verified in Resend)");
errors.push(...(await liveChecks()));
if (errors.length) {
  console.error(`Fix these in .env first:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

for (const required of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"])
  if (!local.has(required) && !remote[required]) console.warn(`warn  ${required} is empty: payments stay disabled until it is set`);
const has = (k: string) => local.has(k) || !!remote[k];
if (!has("RESEND_API_KEY")) console.warn("warn  RESEND_API_KEY / EMAIL_FROM are empty: new signups can't receive their verification code");
if (!has("BILLING_ARC_ADDRESS")) console.warn("warn  BILLING_ARC_ADDRESS is empty: billing stays off (every service is free)");
if (has("GOOGLE_CLIENT_ID") !== has("GOOGLE_CLIENT_SECRET")) console.warn("warn  set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for Google sign-in");

for (const key of toSet) {
  const status = remote[key] !== undefined ? "update" : "add";
  if (dryRun) {
    console.log(`${status.padEnd(6)}${key} (dry run)`);
    continue;
  }
  const r = railway(["variable", "set", key, "--stdin", "--skip-deploys"], local.get(key));
  if (r.status !== 0) {
    console.error(`failed ${key}: ${r.stderr.trim()}`);
    process.exit(1);
  }
  console.log(`${status.padEnd(6)}${key}`);
}

if (dryRun || !toSet.length) {
  console.log(toSet.length ? "Dry run complete; nothing was changed." : "Nothing to upload.");
  process.exit(0);
}
const redeploy = railway(["redeploy", "--yes"]);
console.log(redeploy.status === 0 ? "Redeploy triggered. Check https://<your-app>/api/health in a minute." : `Variables saved, but redeploy failed: ${redeploy.stderr.trim()}\nRun: npx railway redeploy --service ${SERVICE}`);
