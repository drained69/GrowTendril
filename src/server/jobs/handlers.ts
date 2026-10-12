import { and, eq, lt, ne, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { runCycle } from "@/server/domain/agent/operator";
import { refreshSettlements } from "@/server/domain/agent/execute";
import { transition } from "@/server/domain/agent/ledger";
import { updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { getWallet, depositToGateway, walletIsLive } from "@/server/integrations/circle/wallets";
import { microToDecimal } from "@/lib/money";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import type { Job } from "@/server/jobs/queue";
import { chargeService, checkOpenInvoices, expireInvoices, InsufficientCredit, refundCharge } from "@/server/domain/billing";
import { reconcileBillingPayments } from "@/server/domain/reconcile/billing";
import { reconcileWalletOutflows } from "@/server/domain/reconcile/wallet";
import { deliver } from "@/server/domain/notifications/webhooks";

/** One handler per job kind. Handlers must be idempotent: a retried job may run again. */
export const HANDLERS: Record<string, (db: DB, job: Job) => Promise<Record<string, unknown>>> = {
  async webhook(db, job) {
    if (typeof job.payload.deliveryId !== "string") throw new Error("Missing notification delivery ID");
    return deliver(db, job.payload.deliveryId, job.attempts >= job.maxAttempts);
  },
  async cycle(db, job) {
    const pid = job.projectId!;
    // Never run two cycles for the same workspace at once. A running job keeps its lease alive,
    // so a run still marked running without one was left behind by a worker that stopped.
    const [other] = await db.select({ id: s.jobs.id }).from(s.jobs).where(and(eq(s.jobs.kind, "cycle"), eq(s.jobs.projectId, pid), eq(s.jobs.status, "running"), ne(s.jobs.id, job.id)));
    if (other) return { skipped: "a cycle is already running" };
    const note = [{ at: new Date().toISOString(), agent: "operator", message: "Interrupted: the server stopped during this cycle, so it was started again." }];
    await db
      .update(s.agentRuns)
      .set({ status: "failed", finishedAt: new Date(), log: sql`${s.agentRuns.log} || ${JSON.stringify(note)}::jsonb` })
      .where(and(eq(s.agentRuns.projectId, pid), eq(s.agentRuns.status, "running")));
    // A scan is a paid service: the workspace owner's balance covers it. Each attempt is its own
    // charge, and a failed attempt is refunded, so a retried job never pays twice.
    const [p] = await db.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, pid));
    if (!p) return { skipped: "workspace not found" };
    const ref = `job:${job.id}:${job.attempts}`;
    try {
      await chargeService(db, { ownerId: p.ownerId, projectId: pid, service: "scan", ref, note: job.trigger === "schedule" ? "Autopilot scan" : "Market scan" });
    } catch (e) {
      if (e instanceof InsufficientCredit) return { skipped: "balance too low", balanceMicro: e.balanceMicro };
      throw e;
    }
    try {
      const r = await runCycle(db, pid, { trigger: job.trigger === "schedule" ? "schedule" : "manual" });
      await db.update(s.projects).set({ lastCycleAt: new Date() }).where(eq(s.projects.id, pid));
      return { runId: r.runId, steps: r.log.length };
    } catch (e) {
      await refundCharge(db, ref, "Scan failed — refunded");
      throw e;
    }
  },

  async settlements(db, job) {
    const r = await refreshSettlements(db, job.projectId!);
    return { ...r };
  },

  async gateway_deposit(db, job) {
    const txId = String(job.payload.transactionId);
    const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    if (!tx || tx.projectId !== job.projectId || tx.kind !== "gateway_deposit" || tx.rail !== "gateway_deposit") throw new Error("deposit transaction not found in this workspace");
    if (tx.state !== "AUTHORIZED") return { skipped: `already ${tx.state}; interrupted deposits must be reconciled before retrying` };
    if (!(await transition(db, tx.id, "EXECUTING", {}, "deposit started"))) return { skipped: "locked" };
    const wallet = await getWallet(db, tx.projectId);
    try {
      if (!walletIsLive(wallet) || wallet!.frozen || wallet!.id !== tx.walletId) throw new Error("Deposit wallet is unavailable, changed, or frozen");
      const r = await depositToGateway(wallet!, microToDecimal(tx.amountMicro));
      await transition(db, tx.id, "SETTLED", { txHash: r.depositTx, explorerUrl: txExplorerUrl(tx.chain, r.depositTx) }, `approve ${r.approveTx ?? "(existing allowance)"}; deposit ${r.depositTx}`);
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

  /** Look on Arc for USDC payments to open invoices (catches payers who closed the page). */
  async billing_check(db) {
    return checkOpenInvoices(db);
  },

  /** Open an exception for any USDC that reached the billing address without matching an invoice. */
  async billing_reconcile(db) {
    return reconcileBillingPayments(db);
  },

  /** Open an exception for any USDC that left the agent wallet without a recorded payment. */
  async wallet_reconcile(db, job) {
    return reconcileWalletOutflows(db, job.projectId!);
  },

  /** Expire stale top-up invoices. (Kept under its old name so queued jobs still run.) */
  async billing_renewals(db) {
    await expireInvoices(db);
    return {};
  },

  /** Remove expired guest accounts (and their demo workspaces) after 7 days. */
  async cleanup(db) {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const gone = await db.delete(s.users).where(and(eq(s.users.isGuest, true), lt(s.users.createdAt, cutoff))).returning({ id: s.users.id });
    await db.delete(s.jobs).where(and(sql`${s.jobs.status} in ('done','failed')`, lt(s.jobs.createdAt, new Date(Date.now() - 30 * 86_400_000))));
    await db.delete(s.webhookDeliveries).where(and(sql`${s.webhookDeliveries.status} in ('delivered','failed')`, lt(s.webhookDeliveries.createdAt, new Date(Date.now() - 90 * 86_400_000))));
    return { guestsRemoved: gone.length };
  },
};
