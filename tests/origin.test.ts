import { afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ value: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => h.value }));
import { appOrigin } from "@/server/lib/origin";

afterEach(() => { vi.unstubAllEnvs(); h.value = new Headers(); });
describe("trusted app origin", () => {
  it("uses the configured HTTPS origin despite spoofed forwarded headers", async () => {
    vi.stubEnv("APP_URL", "https://growtendril.xyz/"); vi.stubEnv("NODE_ENV", "production");
    h.value = new Headers({ "x-forwarded-host": "attacker.example" });
    expect(await appOrigin()).toBe("https://growtendril.xyz");
  });
  it("requires an explicit origin in production", async () => {
    vi.stubEnv("APP_URL", ""); vi.stubEnv("NODE_ENV", "production");
    await expect(appOrigin()).rejects.toThrow(/Set APP_URL/);
  });
  it.each(["javascript:alert(1)", "https://user:secret@example.com", "https://example.com/path", "http://example.com"])("rejects invalid production origin %s", async (origin) => {
    vi.stubEnv("APP_URL", origin); vi.stubEnv("NODE_ENV", "production");
    await expect(appOrigin()).rejects.toThrow();
  });
  it("uses a local development host and ignores forwarded values", async () => {
    vi.stubEnv("APP_URL", ""); vi.stubEnv("NODE_ENV", "development");
    h.value = new Headers({ host: "127.0.0.1:3100", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" });
    expect(await appOrigin()).toBe("http://127.0.0.1:3100");
    h.value = new Headers({ host: "attacker.example" });
    await expect(appOrigin()).rejects.toThrow(/Set APP_URL/);
  });
});
