import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";

// No Circle in tests: the wallet "can sign", and every App Kit send fails like an unreachable API.
vi.mock("@/server/integrations/circle/signer", () => ({ signerFor: () => ({ kind: "test" }) }));
vi.mock("@/server/integrations/circle/appkit", () => ({
  appKitSend: async () => {
    throw new Error("Circle unreachable in tests");
  },
  appKitBridge: async () => {
    throw new Error("Circle unreachable in tests");
  },
}));

let db: DB;
let s: typeof import("@/server/db/schema");
let x: typeof import("@/server/domain/growth/experiments");
let exec: typeof import("@/server/domain/agent/execute");
let setup: typeof import("@/server/domain/workspace/setup");
let missionId: string;

const EXP = "exp-1";
const toMicro = (n: number) => Math.round(n * 1_000_000);

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  x = await import("@/server/domain/growth/experiments");
  exec = await import("@/server/domain/agent/execute");
  setup = await import("@/server/domain/workspace/setup");
  await db.insert(s.users).values({ id: "u1", email: "owner@example.test", name: "Owner", passwordHash: "x" });
  await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Crumb Club", webhookSecret: "secret" });
  await setup.startMission(db, { projectId: "p1", templateKey: "first_customers", goal: 25, days: 30, budget: "300" });
  await setup.activateWorkspace(db, { projectId: "p1", rules: { dailySpend: "50", hardCeiling: "10", autonomousLimit: "2" }, autopilot: "off" });
  [{ id: missionId }] = await db.select({ id: s.missions.id }).from(s.missions).where(eq(s.missions.projectId, "p1"));
  await db.insert(s.experiments).values({
    id: EXP,
    projectId: "p1",
    missionId,
    number: 1,
    title: "Own the conversation",
    hypothesis: "A definitive post reaches people already searching.",
    channel: "content",
    budgetCategory: "content",
    target: "10 visits",
    action: "Commission one post",
    budgetMicro: toMicro(30),
    successEvent: "purchase",
    successTarget: 2,
    stopMaxCpaMicro: toMicro(72),
    stopAfterSpendMicro: toMicro(15),
    timeframeDays: 10,
    status: "proposed",
    dataMode: "LIVE",
  });
});

const status = async () => (await db.select({ st: s.experiments.status }).from(s.experiments).where(eq(s.experiments.id, EXP)))[0].st;
const pendingApprovals = () => db.select().from(s.approvals).where(and(eq(s.approvals.projectId, "p1"), eq(s.approvals.status, "pending")));

describe("paying for an experiment", () => {
  it("asks who gets paid before a non-creator experiment can launch", async () => {
    await expect(x.launchExperiment(db, { projectId: "p1", experimentId: EXP })).rejects.toThrow(/who gets paid/);
  });

  it("splits a tranche above the per-payment ceiling into installments", async () => {
    const first = await x.nextInstallment(db, { id: EXP, budgetMicro: toMicro(30), stopAfterSpendMicro: toMicro(15) }, "first", toMicro(10));
    expect(first).toMatchObject({ amount: toMicro(10), installment: 1, dueMicro: toMicro(15) });
  });

  it("is denied with a clear reason while no wallet can pay", async () => {
    await db.update(s.experiments).set({ recipientAddress: "0x000000000000000000000000000000000000bEEF", recipientLabel: "Writer" }).where(eq(s.experiments.id, EXP));
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: EXP });
    expect(r.verdict).toBe("DENY");
    expect(r.message).toMatch(/wallet/i);
    expect(r.message).not.toMatch(/autonomous limit/); // only the blocking rule, not approval-level noise
    expect(await status()).toBe("proposed");
  });

  it("sends payments to people for approval, and a failed payment reopens the experiment", async () => {
    await db.insert(s.wallets).values({ id: "w1", projectId: "p1", provider: "circle_dcw", address: "0x1111111111111111111111111111111111111111", circleWalletId: "cw", blockchain: "ARC", status: "ACTIVE", dataMode: "LIVE" });
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: EXP });
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    expect(await status()).toBe("awaiting_approval");
    const [ap] = await pendingApprovals();
    expect(ap.requestedMicro).toBe(toMicro(10));

    // While it waits, the rest of tranche 1 is what's left.
    const next = await x.nextInstallment(db, { id: EXP, budgetMicro: toMicro(30), stopAfterSpendMicro: toMicro(15) }, "first", toMicro(10));
    expect(next.amount).toBe(toMicro(5));

    await exec.resolveApproval(db, { approvalId: ap.id, userId: "u1", resolution: "approve" });
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, ap.transactionId!));
    expect(tx.state).toBe("FAILED");
    expect(await status()).toBe("proposed"); // not stuck in awaiting_approval
  });

  it("treats a retry after a failure as a new payment, and a rejection reopens instead of stopping", async () => {
    const r = await x.launchExperiment(db, { projectId: "p1", experimentId: EXP });
    expect(r.verdict).toBe("APPROVAL_REQUIRED");
    expect(r.message).not.toMatch(/duplicate/i);
    const [ap] = await pendingApprovals();
    await exec.resolveApproval(db, { approvalId: ap.id, userId: "u1", resolution: "reject", note: "not yet" });
    expect(await status()).toBe("proposed");
  });
});
