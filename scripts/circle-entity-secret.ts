/**
 * One-time Circle setup for Arc mainnet: generate an entity secret, register it with Circle,
 * and write it into .env. Run once per Circle account:
 *
 *   npm run circle:entity-secret
 *
 * Reads CIRCLE_API_KEY from .env (must be a production key). The secret is never printed.
 * The recovery file is saved outside the repository; back it up somewhere offline.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ENV_FILE = path.join(process.cwd(), ".env");
const RECOVERY_DIR = path.join(homedir(), ".growtendril", "circle-recovery");

function readEnv(): string {
  if (!existsSync(ENV_FILE)) throw new Error(".env not found in the project root");
  return readFileSync(ENV_FILE, "utf8");
}

function envValue(text: string, key: string): string {
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2") : "";
}

const text = readEnv();
const apiKey = envValue(text, "CIRCLE_API_KEY");
if (!apiKey) {
  console.error("Add CIRCLE_API_KEY (your production key) to .env first.");
  process.exit(1);
}
if (apiKey.startsWith("TEST_API_KEY:")) {
  console.error("CIRCLE_API_KEY is a testnet key. Arc mainnet needs a production (LIVE_API_KEY:) key.");
  process.exit(1);
}
if (!apiKey.startsWith("LIVE_API_KEY:") || apiKey.split(":").length !== 3) {
  console.error("CIRCLE_API_KEY is incomplete. Paste the whole key Circle shows once at creation: LIVE_API_KEY:<id>:<secret>");
  process.exit(1);
}
if (envValue(text, "CIRCLE_ENTITY_SECRET")) {
  console.error("CIRCLE_ENTITY_SECRET is already set in .env. Nothing to do.");
  process.exit(1);
}

const { registerEntitySecretCiphertext } = await import("@circle-fin/developer-controlled-wallets");
const entitySecret = randomBytes(32).toString("hex");
mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });

try {
  // The SDK resolves this path relative to the working directory.
  await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: path.relative(process.cwd(), RECOVERY_DIR) });
} catch (e) {
  const msg = (e as Error).message ?? String(e);
  console.error(`Circle rejected the registration: ${msg}`);
  console.error("If this account already has an entity secret, paste that existing secret into .env as CIRCLE_ENTITY_SECRET instead.");
  process.exit(1);
}

writeFileSync(ENV_FILE, text.replace(/^CIRCLE_ENTITY_SECRET=.*$/m, `CIRCLE_ENTITY_SECRET=${entitySecret}`), { mode: 0o600 });
console.log("Entity secret registered with Circle and written to .env as CIRCLE_ENTITY_SECRET.");
console.log(`Recovery file saved under ${RECOVERY_DIR}. Copy it to a password manager or offline storage.`);
