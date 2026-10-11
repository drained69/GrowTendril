import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { safeNext } from "@/server/auth/next-step";
import { newOAuthState, packState, unpackState, identityFromIdToken } from "@/server/auth/google";
import { createSessionToken, verifySessionToken } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { readRequestBody } from "@/server/security/request-body";

process.env.SESSION_SECRET = "auth-boundary-tests-" + "x".repeat(32);

describe("post-auth return paths", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2f%2fevil.test", "/%255cevil.test", "/%252f%252fevil.test", "/%0aevil.test", "/\nevil.test", " /app", "", null])("rejects %s", (value) => {
    expect(safeNext(value)).toBe("/app");
  });
  it.each(["/app/settings", "/app?tab=team", "/app#activity", "/invite/aBcdEf0123456789", "/app?next=https%3A%2F%2Fexample.test"]) ("keeps %s", (value) => {
    expect(safeNext(value)).toBe(value);
  });
});

describe("signed auth values", () => {
  const signed = (claims: Record<string, unknown>) => {
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${body}.${createHmac("sha256", process.env.SESSION_SECRET!).update(body).digest("base64url")}`;
  };
  it("rejects session payloads without a finite expiry or a valid version", () => {
    expect(verifySessionToken(createSessionToken("user", 7))).toEqual({ uid: "user", v: 7 });
    for (const claims of [{ uid: "user" }, { uid: "user", exp: "9999999999" }, { uid: "user", exp: 9999999999, v: -1 }, { uid: 123, exp: 9999999999 }]) expect(verifySessionToken(signed(claims))).toBeNull();
    expect(verifySessionToken(`${createSessionToken("user")}.extra`)).toBeNull();
  });
  it("expires OAuth state on the server even if a cookie is replayed", () => {
    const state = newOAuthState("/app", null);
    expect(unpackState(packState(state))).toEqual(state);
    expect(unpackState(packState({ ...state, issuedAt: Date.now() - 600_000 }))).toBeNull();
    expect(unpackState(packState({ ...state, issuedAt: Date.now() + 600_000 }))).toBeNull();
    expect(unpackState(`${packState(state)}.extra`)).toBeNull();
  });
  it("rejects malformed Google expiry claims", () => {
    const claims = { iss: "https://accounts.google.com", aud: "client", exp: "9999999999", sub: "user", email: "user@example.test", email_verified: true };
    const token = `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
    expect(() => identityFromIdToken(token, "client")).toThrow(/expired/);
  });
  it("fails closed on malformed stored password hashes", () => {
    for (const hash of ["scrypt$zz$zz", "scrypt$12$ff", "scrypt$" + "a".repeat(32) + "$" + "f".repeat(128) + "$extra", "x"]) expect(verifyPassword("anything", hash)).toBe(false);
  });
});

describe("bounded API bodies", () => {
  it("bounds encoded byte length, including multibyte text", async () => {
    await expect(readRequestBody(new Request("https://example.test", { method: "POST", body: "ééé" }), 5)).rejects.toMatchObject({ status: 413 });
    expect(await readRequestBody(new Request("https://example.test", { method: "POST", body: "éé" }), 5)).toBe("éé");
  });
  it("rejects large declared bodies and overflowing streams without trusting the header", async () => {
    await expect(readRequestBody(new Request("https://example.test", { method: "POST", body: "small", headers: { "content-length": "1000" } }), 10)).rejects.toMatchObject({ status: 413 });
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("123456")); controller.enqueue(new TextEncoder().encode("789012")); controller.close(); } });
    const req = new Request("https://example.test", { method: "POST", body: stream, duplex: "half", headers: { "content-length": "1" } } as RequestInit);
    await expect(readRequestBody(req, 10)).rejects.toMatchObject({ status: 413 });
  });
});
