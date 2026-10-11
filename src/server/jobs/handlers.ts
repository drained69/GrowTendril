import { and, eq, lt, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { runCycle, runScan } from "@/server/domain/agent/operator";
import { syncProjectCampaigns } from "@/server/domain/growth/creator-campaigns";
import { refreshSettlements } from "@/server/domain/agent/execute";
import { transition } from "@/server/domain/agent/ledger";
import { updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { getWallet, depositToGateway, walletIsLive } from "@/server/integrations/circle/wallets";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { microToDecimal } from "@/lib/money";
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

  /**
   * Wallet → Gateway deposit. Runs at most once per transaction: a run that finds the transaction
   * already EXECUTING (worker crashed or lease expired mid-deposit) does not deposit again, since the
   * first attempt may have reached the chain. Errors fail the job so they show up as failed, not done.
   */
  async gateway_deposit(db, job) {
    const txId = String(job.payload.transactionId);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    if (!tx) throw new Error("deposit transaction not found");
    if (tx.kind !== "gateway_deposit") throw new Error(`transaction ${txId} is not a Gateway deposit`);
    if (tx.state === "EXECUTING") throw new Error("Deposit was interrupted after it started — not re-running to avoid a double deposit. Check the wallet on the explorer before depositing again.");
    if (tx.state !== "AUTHORIZED") return { skipped: `already ${tx.state}` };
    if (!(await transition(db, tx.id, "EXECUTING", {}, "deposit started"))) return { skipped: "locked" };
    const wallet = await getWallet(db, tx.projectId);
    try {
      if (!wallet || !walletIsLive(wallet)) throw new Error("The workspace wallet cannot sign on this deployment");
      // Re-check the kill switch at execution time: the wallet may have been frozen after the deposit was queued.
      if (wallet.frozen) throw new Error("Wallet frozen (kill switch on) — deposit not sent");
      const r = await depositToGateway(wallet, microToDecimal(tx.amountMicro));
      await transition(db, tx.id, "SETTLED", { txHash: r.depositTx, explorerUrl: txExplorerUrl(tx.chain, r.depositTx) }, `approve ${r.approveTx ?? "(existing allowance)"}; deposit ${r.depositTx}`);
      await updateDecision(db, tx.decisionId, { status: "executed", result: { ...r } });
      await writeReceipt(db, tx.decisionId);
      return r;
    } catch (e) {
      const msg = (e as Error).message;
      await transition(db, tx.id, "FAILED", { error: msg }, msg);
      await updateDecision(db, tx.decisionId, { status: "failed", result: { error: msg } });
      await writeReceipt(db, tx.decisionId);
      throw e;
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
