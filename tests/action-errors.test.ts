import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
import { ActionError, fail } from "@/server/actions/_common";

describe("action errors", () => {
  it("handles bracket-prefixed text without trying to parse it as JSON", () => {
    expect(fail(new Error("[rss] network unavailable"))).toEqual({ ok: false, error: "[rss] network unavailable" });
  });
  it("keeps friendly validation and permission errors", () => {
    const parsed = z.string().min(8, "Password must be at least 8 characters").safeParse("short");
    if (parsed.success) throw new Error("Expected validation failure");
    expect(fail(parsed.error)).toEqual({ ok: false, error: "Password must be at least 8 characters" });
    expect(fail(new ActionError("You cannot do this"))).toEqual({ ok: false, error: "You cannot do this" });
  });
  it("masks database parameters and internal exceptions", () => {
    const dbError = new Error("Failed query: insert credentials values($1)\nparams: private-key");
    dbError.name = "DrizzleQueryError";
    expect(JSON.stringify(fail(dbError))).not.toContain("private-key");
    expect(JSON.stringify(fail(new TypeError("Cannot read secret.foo")))).not.toContain("secret.foo");
  });
});
