import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import type { SafeResponse } from "@/server/security/safe-fetch";

process.env.PGLITE_DIR = "memory://";

let db: DB;
let s: typeof import("@/server/db/schema");
let w: typeof import("@/server/domain/notifications/webhooks");
let hmac: typeof import("@/server/security/hmac");

const SLACK = "https://hooks.slack.com/services/T000/B000/XXXXsecretpath";
const JSON_URL = "https://example.com/hooks/growtendril";

type Sent = { url: string; body: string; headers: Record<string, string> };
const sent: Sent[] = [];
const reply = (status: number) => async (url: string | URL, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<SafeResponse> => {
  sent.push({ url: String(url), body: opts.body ?? "", headers: opts.headers ?? {} });
  return { url: String(url), status, ok: status >= 200 && status < 300, headers: {}, body: status >= 400 ? "nope" : "ok", truncated: false };
};

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  w = await import("@/server/domain/notifications/webhooks");
  hmac = await import("@/server/security/hmac");
  await db.insert(s.users).values({ id: "u1", email: "o@example.com", name: "Owner", passwordHash: "x" });
  await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Acme <!channel>", webhookSecret: "w" });
});

async function addEndpoint(id: string, url: string, format: "json" | "slack" | "discord", events: string[]) {
  const secret = w.newSigningSecret();
  await db.insert(s.webhookEndpoints).values({ id, projectId: "p1", format, events, ...w.seal(url, secret) });
  return secret;
}

describe("endpoint URLs", () => {
  it("accepts real Slack and Discord webhook URLs and rejects lookalikes and private hosts", () => {
    expect(w.validateEndpointUrl(SLACK, "slack")).toBe(SLACK);
    expect(w.validateEndpointUrl("https://discord.com/api/webhooks/1/abc", "discord")).toContain("discord.com");
    expect(() => w.validateEndpointUrl("https://hooks.slack.com.evil.io/services/x", "slack")).toThrow(/Slack URLs/);
    expect(() => w.validateEndpointUrl("https://example.com/api/webhooks/1", "discord")).toThrow(/Discord URLs/);
    expect(() => w.validateEndpointUrl("http://127.0.0.1:8080/hook", "json")).toThrow(/can't be used/);
    expect(() => w.validateEndpointUrl("http://169.254.169.254/latest", "json")).toThrow(/can't be used/);
  });

  it("masks the URL for display and keeps the real one sealed", () => {
    const sealed = w.seal(SLACK, "whsec_x");
    expect(sealed.urlHint).toBe("hooks.slack.com/…path");
    expect(sealed.sealed).not.toContain("hooks.slack.com");
    expect(w.unseal(sealed.sealed)).toEqual({ url: SLACK, secret: "whsec_x" });
  });
});

describe("payload formats", () => {
  const env = { id: "evt_1", type: "approval.requested" as const, created_at: "2026-01-01T00:00:00Z", network: "testnet" as const, workspace: { id: "p1", name: "Acme <!channel>" }, summary: "Approval needed: @everyone <@123>", url: null, data: {} };
  it("escapes Slack control sequences so user text can't ping a channel", () => {
    const body = JSON.parse(w.formatBody("slack", env));
    expect(body.text).not.toContain("<!channel>");
    expect(body.text).toContain("&lt;!channel&gt;");
  });
  it("disables Discord mentions", () => {
    expect(JSON.parse(w.formatBody("discord", env)).allowed_mentions).toEqual({ parse: [] });
  });
  it("sends the full envelope as JSON", () => {
    expect(JSON.parse(w.formatBody("json", env))).toEqual(env);
  });
});

describe("notify and deliver (real Postgres via PGlite)", () => {
  it("queues only for subscribed, enabled endpoints, and each event key once", async () => {
    await addEndpoint("e_json", JSON_URL, "json", ["approval.requested", "payment.settled"]);
    await addEndpoint("e_slack", SLACK, "slack", ["payment.settled"]);
    await addEndpoint("e_off", "https://example.org/x", "json", ["approval.requested"]);
    await db.update(s.webhookEndpoints).set({ enabled: false }).where(eq(s.webhookEndpoints.id, "e_off"));

    const n = await w.notifyApproval(db, { projectId: "p1", approvalId: "ap1", title: "Pay creator", requestedMicro: 25_000_000 });
    expect(n).toBe(1);
    expect(await w.notifyApproval(db, { projectId: "p1", approvalId: "ap1", title: "Pay creator", requestedMicro: 25_000_000 })).toBe(0);
    const rows = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.eventKey, "approval.requested:ap1"));
    expect(rows.map((r) => r.endpointId)).toEqual(["e_json"]);
    const jobs = await db.select().from(s.jobs).where(eq(s.jobs.kind, "webhook"));
    expect(jobs.length).toBe(1);
    expect(jobs[0].maxAttempts).toBe(w.MAX_ATTEMPTS);
  });

  it("signs JSON deliveries so receivers can verify them", async () => {
    const secret = await addEndpoint("e_sig", "https://example.net/hook", "json", ["budget.threshold"]);
    await w.notifyBudget(db, { projectId: "p1", missionId: "m1", missionName: "First 100", budgetMicro: 100_000_000, spentMicro: 85_000_000 });
    const [d] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.endpointId, "e_sig"));
    expect(d.eventKey).toBe("budget.threshold:m1:80");
    sent.length = 0;
    const r = await w.deliver(db, d.id, { final: false }, reply(200) as never);
    expect(r.ok).toBe(true);
    expect(hmac.verifyWebhook(secret, sent[0].body, sent[0].headers["x-growtendril-signature"]).ok).toBe(true);
    expect(sent[0].headers["x-growtendril-event"]).toBe("budget.threshold");
    expect(JSON.parse(sent[0].body).data.threshold_percent).toBe(80);
    const [after] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, d.id));
    expect(after.status).toBe("delivered");
    // Crossing 100% later is a separate event; 80% is not sent again.
    await w.notifyBudget(db, { projectId: "p1", missionId: "m1", missionName: "First 100", budgetMicro: 100_000_000, spentMicro: 100_000_000 });
    const keys = (await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.endpointId, "e_sig"))).map((x) => x.eventKey).sort();
    expect(keys).toEqual(["budget.threshold:m1:100", "budget.threshold:m1:80"]);
  });

  it("retries failures, records the final one, and switches the endpoint off after repeated failures", async () => {
    await addEndpoint("e_bad", "https://example.com/broken", "json", ["payment.failed"]);
    for (let i = 0; i < w.DISABLE_AFTER; i++) {
      await w.notify(db, "p1", { event: "payment.failed", key: `payment.failed:t${i}`, summary: "x", data: {} });
      const [d] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.eventKey, `payment.failed:t${i}`));
      if (i === 0) await expect(w.deliver(db, d.id, { final: false }, reply(500) as never)).rejects.toThrow(/HTTP 500/);
      await w.deliver(db, d.id, { final: true }, reply(500) as never);
      const [row] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.id, d.id));
      expect(row.status).toBe("failed");
    }
    const [ep] = await db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id, "e_bad"));
    expect(ep.enabled).toBe(false);
    expect(ep.disabledReason).toMatch(/in a row/);
  });

  it("stops at once on 410 Gone", async () => {
    await addEndpoint("e_gone", "https://example.com/gone", "json", ["campaign.closed"]);
    await w.notify(db, "p1", { event: "campaign.closed", key: "campaign.closed:c1", summary: "x", data: {} });
    const [d] = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.endpointId, "e_gone"));
    await w.deliver(db, d.id, { final: false }, reply(410) as never);
    const [ep] = await db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id, "e_gone"));
    expect(ep.enabled).toBe(false);
  });

  it("sends a test to one endpoint and records it", async () => {
    sent.length = 0;
    const r = await w.sendTest(db, "p1", "e_slack", reply(200) as never);
    expect(r.ok).toBe(true);
    expect(sent[0].url).toBe(SLACK);
    expect(JSON.parse(sent[0].body).text).toContain("Test notification");
  });

  it("never throws into the caller, even when the database call fails", async () => {
    const broken = { select: () => { throw new Error("db down"); } } as unknown as DB;
    expect(await w.notify(broken, "p1", { event: "payment.settled", key: "k", summary: "x", data: {} })).toBe(0);
  });
});

describe("ledger emits payment events", () => {
  it("queues payment.settled when a transaction settles", async () => {
    const { createTransaction, transition } = await import("@/server/domain/agent/ledger");
    await db.insert(s.agentDecisions).values({ id: "d1", projectId: "p1", number: 1, agent: "operator", kind: "payout", action: {}, rationale: "test", status: "executed", dataMode: "TESTNET" });
    const { tx } = await createTransaction(db, { projectId: "p1", decisionId: "d1", kind: "send", rail: "app_kit_send", budgetCategory: "kol", amountMicro: 5_000_000, chain: "ARC-TESTNET", idempotencyKey: "idem-1", dataMode: "TESTNET" });
    await transition(db, tx.id, "AUTHORIZED");
    await transition(db, tx.id, "EXECUTING");
    await transition(db, tx.id, "SETTLED", { txHash: "0xabc" });
    const rows = await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.eventKey, `payment.settled:${tx.id}`));
    expect(rows.map((r) => r.endpointId).sort()).toEqual(["e_json", "e_slack"]);
  });
});
