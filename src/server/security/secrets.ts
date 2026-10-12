import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Envelope for secrets at rest (provider API keys). AES-256-GCM with a 32-byte key from
 * ENCRYPTION_KEY (hex or base64). In development a key is generated under .data/ so
 * restarts can still decrypt; production refuses to start without one.
 *
 * Stored format: base64( iv[12] | tag[16] | ciphertext ).
 */
let key: Buffer | null = null;

function loadKey(): Buffer {
  if (key) return key;
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
    return (key = k);
  }
  if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required in production");
  const file = path.join(process.cwd(), ".data", "encryption-key");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return (key = Buffer.from(readFileSync(file, "utf8").trim(), "hex"));
}

export function encryptJson(value: Record<string, string>, aad = "growthos"): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", loadKey(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptJson(blob: string, aad = "growthos"): Record<string, string> {
  const buf = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", loadKey(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}

/**
 * Stable, non-reversible alias for an identifier (e.g. a customer ID that may be an email).
 * Keyed with the server secret and scoped, so aliases can't be dictionary-guessed from the
 * identifier and the same person gets unrelated aliases in different workspaces.
 */
export function pseudonym(scope: string, value: string, length = 8): string {
  return createHmac("sha256", loadKey()).update(`pseudonym:${scope}:${value}`).digest("hex").slice(0, length);
}

/** "••••a1f3" — enough to recognize a key, never enough to use it. */
export function secretHint(v: string): string {
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}
