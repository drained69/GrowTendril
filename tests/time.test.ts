import { describe, it, expect } from "vitest";
import { relTime } from "../src/lib/time";

describe("relative times", () => {
  const now = Date.UTC(2026, 0, 10);
  it("reads the past and the future naturally", () => {
    expect(relTime(new Date(now - 90_000), now)).toBe("1m ago");
    expect(relTime(new Date(now - 3 * 86_400_000), now)).toBe("3d ago");
    expect(relTime(new Date(now + 7 * 86_400_000), now)).toBe("in 7d");
    expect(relTime(new Date(now + 2 * 3_600_000), now)).toBe("in 2h");
    expect(relTime(new Date(now), now)).toBe("just now");
    expect(relTime(null, now)).toBe("—");
  });
});
