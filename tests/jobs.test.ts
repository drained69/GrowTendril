import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";

const cycles = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/server/domain/agent/operator", () => ({
  runCycle: async () => (cycles.count++, { runId: "new-run", log: [] }),
}));

let db: DB;
let s: typeof import("@/server/db/schema");
let q: typeof import("@/server/jobs/queue");

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  q = await import("@/server/jobs/queue");
});

describe("job queue (real Postgres via PGlite)", () => {
  it("dedupes, claims atomically, retries with backoff and fails after maxAttempts", async () => {
    const a = await q.enqueue(db, { kind: "cleanup", dedupeKey: "k1", maxAttempts: 2 });
    const dup = await q.enqueue(db, { kind: "cleanup", dedupeKey: "k1" });
    expect(a).not.toBeNull();
    expect(dup).toBeNull();

    const j1 = await q.claimNext(db, "w1");
    expect(j1?.id).toBe(a!.id);
    expect(j1?.status).toBe("running");
    expect(await q.claimNext(db, "w2")).toBeNull(); // nothing else due

    await q.failJob(db, j1!, "boom");
    const [after1] = await db.select().from(s.jobs).where(eq(s.jobs.id, a!.id));
    expect(after1.status).toBe("queued");
    expect(after1.runAt.getTime()).toBeGreaterThan(Date.now()); // backed off
    expect(await q.claimNext(db, "w1")).toBeNull(); // not due yet

    await db.update(s.jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(s.jobs.id, a!.id));
    const j2 = await q.claimNext(db, "w1");
    expect(j2?.attempts).toBe(2);
    await q.failJob(db, j2!, "boom again");
    const [after2] = await db.select().from(s.jobs).where(eq(s.jobs.id, a!.id));
    expect(after2.status).toBe("failed");
  });

  it("recovers jobs whose lease expired", async () => {
    const j = await q.enqueue(db, { kind: "cleanup", dedupeKey: "k2" });
    await db.update(s.jobs).set({ status: "running", lockedUntil: new Date(Date.now() - 1000) }).where(eq(s.jobs.id, j!.id));
    const claimed = await q.claimNext(db, "w3");
    expect(claimed?.id).toBe(j!.id);
    await q.completeJob(db, claimed!, { ok: true });
    const [done] = await db.select().from(s.jobs).where(eq(s.jobs.id, j!.id));
    expect(done.status).toBe("done");
  });

  it("keeps a lease short and renews it only for the worker that holds the job", async () => {
    const j = await q.enqueue(db, { kind: "cleanup", dedupeKey: "k3" });
    const claimed = await q.claimNext(db, "w4");
    expect(claimed!.lockedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(q.LEASE_MS);
    await db.update(s.jobs).set({ lockedUntil: new Date(Date.now() + 1000) }).where(eq(s.jobs.id, j!.id));
    await q.renewLease(db, j!.id, "someone-else", claimed!.attempts);
    const [other] = await db.select().from(s.jobs).where(eq(s.jobs.id, j!.id));
    expect(other.lockedUntil!.getTime() - Date.now()).toBeLessThan(2000);
    await q.renewLease(db, j!.id, "w4", claimed!.attempts);
    const [mine] = await db.select().from(s.jobs).where(eq(s.jobs.id, j!.id));
    expect(mine.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(q.LEASE_MS - 5000);
    await q.completeJob(db, claimed!);
  });

  it("fences stale workers after a lease is reclaimed, even if the worker ID is reused", async () => {
    const j = await q.enqueue(db, { kind: "cleanup", dedupeKey: "stale-worker", maxAttempts: 3 });
    const first = await q.claimNext(db, "reused-worker");
    expect(first!.id).toBe(j!.id);
    await db.update(s.jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(s.jobs.id, j!.id));
    const second = await q.claimNext(db, "reused-worker");
    expect(second!.attempts).toBe(2);
    expect(await q.completeJob(db, first!, { stale: true })).toBe(false);
    await q.failJob(db, first!, "stale error");
    await q.renewLease(db, j!.id, "reused-worker", first!.attempts);
    const [current] = await db.select().from(s.jobs).where(eq(s.jobs.id, j!.id));
    expect(current).toMatchObject({ status: "running", attempts: 2, lastError: expect.stringMatching(/lease expired/) });
    expect(await q.completeJob(db, second!, { fresh: true })).toBe(true);
  });

  it("never retries an expired final attempt", async () => {
    const j = await q.enqueue(db, { kind: "gateway_deposit", dedupeKey: "one-shot", maxAttempts: 1 });
    const claim = await q.claimNext(db, "deposit-worker");
    expect(claim!.id).toBe(j!.id);
    await db.update(s.jobs).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(s.jobs.id, j!.id));
    expect(await q.claimNext(db, "other-worker")).toBeNull();
    const [failed] = await db.select().from(s.jobs).where(eq(s.jobs.id, j!.id));
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(await q.completeJob(db, claim!)).toBe(false);
  });
});

describe("operator cycle after a crash", () => {
  it("closes the run a stopped worker left behind and runs the cycle again", async () => {
    const { HANDLERS } = await import("@/server/jobs/handlers");
    await db.insert(s.users).values({ id: "u1", email: "owner@example.test", name: "Owner", passwordHash: "x" });
    await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Crumb Club", webhookSecret: "secret" });
    await db.insert(s.agentRuns).values({ id: "orphan", projectId: "p1", trigger: "schedule", status: "running" });

    const job = await q.enqueue(db, { kind: "cycle", projectId: "p1", dedupeKey: "c1" });
    const claimed = await q.claimNext(db, "w5");
    expect(await HANDLERS.cycle(db, claimed!)).toMatchObject({ runId: "new-run" });
    expect(cycles.count).toBe(1);
    const [orphan] = await db.select().from(s.agentRuns).where(eq(s.agentRuns.id, "orphan"));
    expect(orphan.status).toBe("failed");
    expect(orphan.log.at(-1)?.message).toMatch(/Interrupted/);

    // A second cycle job for the same workspace waits while one is genuinely running.
    const second = await q.enqueue(db, { kind: "cycle", projectId: "p1", dedupeKey: "c2" });
    expect(second!.id).toBe(claimed!.id);
    expect(await HANDLERS.cycle(db, { ...claimed!, id: "concurrent-cycle" })).toMatchObject({ skipped: expect.stringMatching(/already running/) });
    expect(cycles.count).toBe(1);
    expect(job).not.toBeNull();
  });

  it("concurrent cycle requests share one queued job", async () => {
    await db.insert(s.projects).values({ id: "p2", ownerId: "u1", name: "Second workspace", webhookSecret: "secret" });
    const jobs = await Promise.all(Array.from({ length: 5 }, () => q.enqueue(db, { kind: "cycle", projectId: "p2", trigger: "user" })));
    expect(new Set(jobs.map((j) => j!.id)).size).toBe(1);
    expect((await db.select().from(s.jobs).where(eq(s.jobs.projectId, "p2")))).toHaveLength(1);
  });
});

describe("scan credit after worker interruption", () => {
  it("refunds an interrupted charge before retry and on an expired final attempt", async () => {
    process.env.BILLING_ARC_ADDRESS = "0x2222222222222222222222222222222222222222";
    try {
      const billing = await import("@/server/domain/billing");
      await db.insert(s.users).values({ id: "billing-owner", email: "billing@example.test", name: "Billing", passwordHash: "x" });
      await db.insert(s.projects).values({ id: "billing-project", ownerId: "billing-owner", name: "Billing", webhookSecret: "x" });
      await billing.addCredit(db, { userId: "billing-owner", amountMicro: 4_000_000, ref: "billing-test-topup" });
      const queued = await q.enqueue(db, { kind: "cycle", projectId: "billing-project", maxAttempts: 2, runAt: new Date(Date.now() - 86_400_000) });
      const first = await q.claimNext(db, "billing-worker");
      expect(first?.id).toBe(queued?.id);
      await billing.chargeService(db, { ownerId: "billing-owner", projectId: "billing-project", service: "scan", ref: `job:${queued!.id}:1` });
      expect(await billing.balanceMicro(db, "billing-owner")).toBe(2_000_000);
      await db.update(s.jobs).set({ lockedUntil: new Date(Date.now() - 1_000) }).where(eq(s.jobs.id, queued!.id));
      const retry = await q.claimNext(db, "billing-worker-2");
      expect(retry?.id).toBe(queued?.id);
      expect(retry?.attempts).toBe(2);
      expect(await billing.balanceMicro(db, "billing-owner")).toBe(4_000_000);
      await billing.chargeService(db, { ownerId: "billing-owner", projectId: "billing-project", service: "scan", ref: `job:${queued!.id}:2` });
      await db.update(s.jobs).set({ lockedUntil: new Date(Date.now() - 1_000) }).where(eq(s.jobs.id, queued!.id));
      await q.claimNext(db, "billing-worker-3");
      const [failed] = await db.select().from(s.jobs).where(eq(s.jobs.id, queued!.id));
      expect(failed.status).toBe("failed");
      expect(await billing.balanceMicro(db, "billing-owner")).toBe(4_000_000);
    } finally { delete process.env.BILLING_ARC_ADDRESS; }
  });

  it("refunds a charged scan when the worker reports failure", async () => {
    process.env.BILLING_ARC_ADDRESS = "0x2222222222222222222222222222222222222222";
    try {
      const billing = await import("@/server/domain/billing");
      const before = await billing.balanceMicro(db, "billing-owner");
      const queued = await q.enqueue(db, { kind: "cycle", projectId: "billing-project", maxAttempts: 1, runAt: new Date(Date.now() - 86_400_000) });
      const claimed = await q.claimNext(db, "billing-fail-worker");
      expect(claimed?.id).toBe(queued?.id);
      await billing.chargeService(db, { ownerId: "billing-owner", projectId: "billing-project", service: "scan", ref: `job:${queued!.id}:1` });
      await q.failJob(db, claimed!, "scan failed");
      expect(await billing.balanceMicro(db, "billing-owner")).toBe(before);
    } finally { delete process.env.BILLING_ARC_ADDRESS; }
  });
});
