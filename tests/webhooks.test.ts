import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
let db: DB;
let s: typeof import("@/server/db/schema");
let hooks: typeof import("@/server/domain/notifications/webhooks");
beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb(); s = client.schema;
  hooks = await import("@/server/domain/notifications/webhooks");
  await db.insert(s.users).values({ id: "notifications-owner", email: "notifications@example.test", name: "Owner" });
  await db.insert(s.projects).values({ id: "notifications-project", ownerId: "notifications-owner", name: "Team <all>", webhookSecret: "fixture" });
});

describe("outbound notifications", () => {
  it("rejects private destinations and format mismatches", () => {
    expect(() => hooks.validateEndpointUrl("http://127.0.0.1:8080/hook", "json")).toThrow();
    expect(() => hooks.validateEndpointUrl("https://localhost/hook", "json")).toThrow();
    expect(() => hooks.validateEndpointUrl("https://example.com/hook", "slack")).toThrow();
    expect(hooks.validateEndpointUrl("https://example.com/hook", "json")).toBe("https://example.com/hook");
  });

  it("encrypts the destination, queues once, and signs the exact delivered body", async () => {
    const url = "https://example.com/hook";
    const secret = hooks.newSigningSecret();
    const sealed = hooks.seal(url, secret);
    expect(sealed).not.toContain(url);
    expect(sealed).not.toContain(secret);
    await db.insert(s.webhookEndpoints).values({ id: "notifications-endpoint", projectId: "notifications-project", urlHint: hooks.maskUrl(url), format: "json", events: ["approval.requested"], sealed });
    const input = { event: "approval.requested" as const, key: "approval:one", summary: "Payment needs approval", path: "/app/approvals", data: { amount_usdc: 2 } };
    expect(await hooks.notify(db, "notifications-project", input)).toBe(1);
    expect(await hooks.notify(db, "notifications-project", input)).toBe(0);
    const [delivery] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.endpointId, "notifications-endpoint"));
    const jobs = await db.select().from(s.jobs).where(eq(s.jobs.kind, "webhook"));
    expect(jobs).toHaveLength(1);
    let signed = false;
    const fake = (async (_url: string | URL, options: { body?: string; headers?: Record<string, string> }) => {
      const { verifyWebhook } = await import("@/server/security/hmac");
      signed = verifyWebhook(secret, options.body ?? "", options.headers?.["x-growtendril-signature"] ?? null).ok;
      return { ok: true, status: 200, url, contentType: "text/plain", text: "ok", headers: {} };
    }) as typeof import("@/server/security/public-http").getPublicText;
    expect(await hooks.deliver(db, delivery.id, false, fake)).toMatchObject({ delivered: true, status: 200 });
    expect(signed).toBe(true);
    expect(await hooks.deliver(db, delivery.id, false, fake)).toEqual({ skipped: true });
  });

  it("records retryable failure and terminal failure", async () => {
    await db.insert(s.webhookDeliveries).values({ id: "failed-delivery", endpointId: "notifications-endpoint", projectId: "notifications-project", event: "approval.requested", eventKey: "approval:failed", payload: { id: "evt_fixture", type: "approval.requested", created_at: new Date().toISOString(), workspace: { id: "notifications-project", name: "Team" }, summary: "Approval needed", url: null, data: {} } });
    const fake = (async () => ({ ok: false, status: 503, url: "https://example.com/hook", contentType: "", text: "private diagnostic", headers: {} })) as typeof import("@/server/security/public-http").getPublicText;
    await expect(hooks.deliver(db, "failed-delivery", false, fake)).rejects.toThrow("HTTP 503");
    expect(await hooks.deliver(db, "failed-delivery", true, fake)).toMatchObject({ delivered: false, status: 503 });
    const [row] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, "failed-delivery"));
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
    expect(row.error).toBe("HTTP 503");
  });

  it("escapes Slack markup and disables Discord mentions", () => {
    const envelope = { id: "evt", type: "webhook.test" as const, created_at: new Date().toISOString(), workspace: { id: "p", name: "<!channel>" }, summary: "@everyone <alert>", url: null, data: {} };
    expect(hooks.formatBody("slack", envelope)).not.toContain("<!channel>");
    expect(JSON.parse(hooks.formatBody("discord", envelope)).allowed_mentions).toEqual({ parse: [] });
  });
});
