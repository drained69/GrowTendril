import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "../src/server/security/hmac";
import { canTransition } from "../src/server/domain/agent/ledger";
import { clientIp, rateLimit } from "../src/server/security/ratelimit";
import { assertPublicUrl, checkUrl, isBlockedAddress, safeFetch } from "../src/server/security/safe-fetch";
import { safeNext } from "../src/server/auth/safe-next";
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

describe("safe fetch (SSRF guard)", () => {
  it("blocks private, loopback, link-local, CGNAT, metadata and special IPv6 addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255", "168.63.129.16"])
      expect(isBlockedAddress(a), a).toBe(true);
    for (const a of ["::1", "::", "fe80::1", "fc00::1", "fd00:ec2::254", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "64:ff9b::a00:1", "ff02::1"]) expect(isBlockedAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isBlockedAddress(a), a).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
  it("rejects unsafe URLs before any network access", () => {
    for (const u of ["http://127.0.0.1/", "http://0x7f.1/", "http://2130706433/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "gopher://example.com/", "http://localhost/", "http://app.localhost/", "http://metadata.google.internal/", "http://intranet/", "http://user:pass@example.com/", "http://example.com:6379/"])
      expect(() => checkUrl(u), u).toThrow();
    expect(checkUrl("https://example.com/feed.xml").hostname).toBe("example.com");
    expect(checkUrl("http://example.com:8080/x").port).toBe("8080");
  });
  it("refuses to fetch or validate private targets", async () => {
    await expect(safeFetch("http://127.0.0.1:8080/")).rejects.toThrow(/private|reserved/);
    await expect(safeFetch("http://[fd00::1]/")).rejects.toThrow(/private|reserved/);
    await expect(assertPublicUrl("http://10.0.0.5/feed")).rejects.toThrow(/private|reserved/);
  });
});

describe("post-login redirect (safeNext)", () => {
  it("keeps same-origin paths and rejects everything else", () => {
    expect(safeNext("/app/settings?tab=x#policy")).toBe("/app/settings?tab=x#policy");
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "/app\n", "/\tevil", "", null, 42, "app"]) expect(safeNext(bad), String(bad)).toBe("/app");
    expect(safeNext("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com"); // stays a path on our origin
  });
});

describe("client IP for rate limiting", () => {
  it("uses the entry appended by our proxy, not the client-supplied left-most one", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("local");
  });
});
