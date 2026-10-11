import { describe, expect, it } from "vitest";
import { microToDecimal, toMicro } from "../src/lib/money";

describe("USDC conversion precision", () => {
  it("keeps decimal inputs exact, including the smallest unit", () => {
    expect(toMicro("2.01")).toBe(2_010_000);
    expect(toMicro("0.000001")).toBe(1);
    expect(toMicro("-5.123456")).toBe(-5_123_456);
    expect(toMicro("1.0000000")).toBe(1_000_000);
    expect(toMicro("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(toMicro(microToDecimal(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects amounts that would silently lose units or precision", () => {
    expect(() => toMicro("1.0000001")).toThrow("6 decimal places");
    expect(() => toMicro("9007199254.740992")).toThrow("safe precision");
    expect(() => toMicro("-9007199254.740992")).toThrow("safe precision");
    expect(() => toMicro("99999999999999999999999999999")).toThrow("safe precision");
    expect(() => toMicro(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => toMicro("1e6")).toThrow();
  });
});
