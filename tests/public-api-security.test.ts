import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const worker = vi.hoisted(() => ({ runOnce: vi.fn(async () => 3) }));
vi.mock("@/server/jobs/worker", () => worker);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("scheduler authentication", () => {
  it("requires the Bearer scheme and compares bytes safely", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const { POST } = await import("@/app/api/cron/cycle/route");
    for (const authorization of ["cron-secret", "Bearer crón-secret", "Bearer wrong", ""]) {
      const response = await POST(new Request("https://example.test/api/cron/cycle", { method: "POST", headers: { authorization } }));
      expect(response.status).toBe(401);
    }
    expect(worker.runOnce).not.toHaveBeenCalled();
    const response = await POST(new Request("https://example.test/api/cron/cycle", { method: "POST", headers: { authorization: "Bearer cron-secret" } }));
    expect(await response.json()).toEqual({ processed: 3 });
    expect(worker.runOnce).toHaveBeenCalledOnce();
  });
});

describe("Circle webhook rejection paths", () => {
  it("returns 400 for signed malformed notifications and accepts pre-broadcast events", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "test-circle-key");
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const encoded = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const fetch = vi.fn(async () => Response.json({ data: { publicKey: encoded } }));
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/webhooks/circle/route");
    for (const body of ["{broken", '{"notification":{"state":123}}', "null"]) {
      const signature = sign("sha256", Buffer.from(body), privateKey).toString("base64");
      const response = await POST(new Request("https://example.test/api/webhooks/circle", { method: "POST", body, headers: { "x-circle-signature": signature, "x-circle-key-id": "test-signing-key" } }));
      expect(response.status).toBe(400);
    }
    // Notifications before broadcast have no transaction hash yet.
    const queued = '{"notificationType":"transactions.transfer","notification":{"state":"QUEUED","txHash":null}}';
    const response = await POST(new Request("https://example.test/api/webhooks/circle", { method: "POST", body: queued, headers: { "x-circle-signature": sign("sha256", Buffer.from(queued), privateKey).toString("base64"), "x-circle-key-id": "test-signing-key" } }));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("bounds requests and rejects invalid key IDs before any network lookup", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "test-circle-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/webhooks/circle/route");
    const large = await POST(new Request("https://example.test/api/webhooks/circle", { method: "POST", body: "x".repeat(100_001) }));
    expect(large.status).toBe(413);
    const invalid = await POST(new Request("https://example.test/api/webhooks/circle", { method: "POST", body: "{}", headers: { "x-circle-signature": "abcd", "x-circle-key-id": "../../other/path" } }));
    expect(invalid.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
