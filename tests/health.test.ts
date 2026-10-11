import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@/server/db/client", () => ({ getDb: vi.fn(async () => ({ execute })) }));
vi.mock("@/server/integrations/circle/config", () => ({ platformCustody: () => false }));
vi.mock("@/server/integrations/llm", () => ({ aiProvider: () => null }));

import { GET } from "@/app/api/health/route";

describe("health check", () => {
  it("checks the active database connection", async () => {
    execute.mockResolvedValueOnce([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("returns 503 when the database is unavailable", async () => {
    execute.mockRejectedValueOnce(new Error("connection lost"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false });
    } finally {
      log.mockRestore();
    }
  });
});
