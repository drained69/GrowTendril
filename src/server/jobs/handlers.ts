import { and, eq, lt, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { runCycle, runScan } from "@/server/domain/agent/operator";
import { syncProjectCampaigns } from "@/server/domain/growth/creator-campaigns";
import { refreshSettlements } from "@/server/domain/agent/execute";
import { transition } from "@/server/domain/agent/ledger";
import { updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { getWallet, depositToGateway } from "@/server/integrations/circle/wallets";
import { ARC, txExplorerUrl } from "@/server/integrations/circle/config";
import type { Job } from "@/server/jobs/queue";

/** One handler per job kind. Handlers must be idempotent: a retried job may run again. */
export const HANDLERS: Record<string, (db: DB, job: Job) => Promise<Record<string, unknown>>> = {
  async cycle(db, job) {
    const pid = job.projectId!;
    // Never run two cycles for the same workspace at once.
    const [running] = await db.select({ id: s.agentRuns.id }).from(s.agentRuns).where(and(eq(s.agentRuns.projectId, pid), eq(s.agentRuns.status, "running"), sql`${s.agentRuns.startedAt} > now() - interval '20 minutes'`));
    if (running) return { skipped: "a cycle is already running" };
    const r = await runCycle(db, pid, { trigger: job.trigger === "schedule" ? "schedule" : "manual" });
    await syncProjectCampaigns(db, pid);
    await db.update(s.projects).set({ lastCycleAt: new Date() }).where(eq(s.projects.id, pid));
    return { runId: r.runId, steps: r.log.length };
  },

  async scan(db, job) {
    const pid = job.projectId!;
    const [running] = await db.select({ id: s.agentRuns.id }).from(s.agentRuns).where(and(eq(s.agentRuns.projectId, pid), eq(s.agentRuns.status, "running"), sql`${s.agentRuns.startedAt} > now() - interval '20 minutes'`));
    if (running) return { skipped: "another run is in progress" };
    const r = await runScan(db, pid);
    await syncProjectCampaigns(db, pid);
    return { runId: r.runId, steps: r.log.length };
  },

  async settlements(db, job) {
    const r = await refreshSettlements(db, job.projectId!);
    return { ...r };
  },

  async gateway_deposit(db, job) {
    const txId = String(job.payload.transactionId);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    if (!tx) throw new Error("deposit transaction not found");
    if (tx.state !== "AUTHORIZED" && tx.state !== "EXECUTING") return { skipped: `already ${tx.state}` };
    if (tx.state === "AUTHORIZED" && !(await transition(db, tx.id, "EXECUTING", {}, "deposit started"))) return { skipped: "locked" };
    const wallet = await getWallet(db, tx.projectId);
    try {
      if (!wallet) throw new Error("no wallet");
      const r = await depositToGateway(wallet, String(job.payload.amount));
      await transition(db, tx.id, "SETTLED", { txHash: r.depositTx, explorerUrl: txExplorerUrl(ARC.appKitChain, r.depositTx) }, `approve ${r.approveTx ?? "(existing allowance)"}; deposit ${r.depositTx}`);
      await updateDecision(db, tx.decisionId, { status: "executed", result: { ...r } });
      await writeReceipt(db, tx.decisionId);
      return r;
    } catch (e) {
      const msg = (e as Error).message;
      await transition(db, tx.id, "FAILED", { error: msg }, msg);
      await updateDecision(db, tx.decisionId, { status: "failed", result: { error: msg } });
      await writeReceipt(db, tx.decisionId);
      return { failed: msg };
    }
  },

  /** Remove expired guest accounts (and their demo workspaces) after 7 days. */
  async cleanup(db) {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const gone = await db.delete(s.users).where(and(eq(s.users.isGuest, true), lt(s.users.createdAt, cutoff))).returning({ id: s.users.id });
    await db.delete(s.jobs).where(and(sql`${s.jobs.status} in ('done','failed')`, lt(s.jobs.createdAt, new Date(Date.now() - 30 * 86_400_000))));
    return { guestsRemoved: gone.length };
  },
};
