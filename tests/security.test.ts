import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "../src/server/security/hmac";
import { canTransition } from "../src/server/domain/agent/ledger";
import { rateLimit } from "../src/server/security/ratelimit";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import { canonicalJson } from "../src/server/lib/ids";

describe("webhook HMAC", () => {
  const secret = "s3cret";
  const body = '{"event":"signup"}';
  it("accepts a valid signature and rejects tampering, staleness and garbage", () => {
    expect(verifyWebhook(secret, body, signWebhook(secret, body)).ok).toBe(true);
    expect(verifyWebhook(secret, body + " ", signWebhook(secret, body)).ok).toBe(false);
    expect(verifyWebhook(secret, body, signWebhook(secret, body, Math.floor(Date.now() / 1000) - 600)).reason).toMatch(/tolerance/);
    expect(verifyWebhook(secret, body, "t=1,v1=zz").ok).toBe(false);
    expect(verifyWebhook(secret, body, null).ok).toBe(false);
  });
});

describe("transaction state machine", () => {
  it("only allows legal transitions", () => {
    expect(canTransition("PROPOSED", "AUTHORIZED")).toBe(true);
    expect(canTransition("AUTHORIZED", "EXECUTING")).toBe(true);
    expect(canTransition("PROPOSED", "SETTLED")).toBe(false); // no skipping policy/execution
    expect(canTransition("DENIED", "AUTHORIZED")).toBe(false); // deny is terminal
    expect(canTransition("SETTLED", "FAILED")).toBe(false);
    expect(canTransition("AWAITING_APPROVAL", "EXECUTING")).toBe(false); // approval must authorize first
  });
});

describe("misc security primitives", () => {
  it("rate limits after capacity", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, { capacity: 3, refillPerSec: 0.001 }).ok).toBe(true);
    expect(rateLimit(key, { capacity: 3, refillPerSec: 0.001 }).ok).toBe(false);
  });
  it("hashes passwords with scrypt", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("forms never leak input into URLs", () => {
  it("every form posts (a server action or method=post), so a native submit can't become a GET", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<form\b([^>]*)>/g)) {
        if (!/\baction=\{/.test(m[1]) && !/method="post"/.test(m[1])) offenders.push(`${file}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
