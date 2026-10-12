import { assertCreatorReward } from "@/server/domain/growth/creator-reward-guard";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId, sha256, canonicalJson } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { ARC, CHAINS, txExplorerUrl } from "@/server/integrations/circle/config";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { appKitSend } from "@/server/integrations/circle/appkit";
import { getSettlement, resolveBatchTx } from "@/server/integrations/circle/gateway";
import { quote } from "@/server/integrations/circle/x402";
import type { Logger } from "@/server/domain/intel/analyze";
import { parseFinancialAction, type SendPaymentAction, type BridgeFundsAction } from "@/server/domain/agent/actions";
import { evaluatePolicy } from "@/server/domain/agent/policy";
import { claimExecution, createTransaction, experimentSpend, loadPolicy, loadPolicyState, transition } from "@/server/domain/agent/ledger";
import { recordDecision, updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { executePurchase } from "@/server/domain/agent/purchase";
import { applyReallocation } from "@/server/domain/growth/learning-run";
import { confirmSend } from "@/server/domain/reconcile/wallet";
import { assertPayeeApprovable } from "@/server/domain/agent/payees";
import { notify } from "@/server/domain/notifications/webhooks";

type Mode = (typeof s.dataMode.enumValues)[number];

export interface ProposalOutcome {
  decisionId: string;
  verdict: "ALLOW" | "APPROVAL_REQUIRED" | "DENY";
  state: string;
  approvalId?: string;
  txHash?: string | null;
  message: string;
}

/**
 * Propose a money movement (send or bridge). It goes through Zod → policy → either executes,
 * lands in the Approval Inbox, or is denied. Free text never reaches this function.
 */
export async function proposeFinancialAction(
  db: DB,
  p: { projectId: string; input: unknown; rationale: string; reasons: string[]; title: string; runId?: string | null; agent?: string; expectedOutcome?: string; evidence?: { url: string; title: string }[]; details?: Record<string, unknown>; log?: Logger },
): Promise<ProposalOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${p.projectId}`}))`);
    return proposeFinancialActionLocked(tx as unknown as DB, p);
  });
}

async function proposeFinancialActionLocked(db: DB, p: Parameters<typeof proposeFinancialAction>[1]): Promise<ProposalOutcome> {
  const log = p.log ?? (() => {});
  const parsed = parseFinancialAction(p.input);
  if (!parsed.success) throw new Error(`Rejected by schema validator: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const action = parsed.data;
  if (action.action !== "send_payment" && action.action !== "bridge_funds") throw new Error("proposeFinancialAction handles send_payment and bridge_funds");

  if (action.action === "send_payment") await assertCreatorReward(db, p.projectId, action);
  const policy = await loadPolicy(db, p.projectId);
  const category = action.action === "bridge_funds" ? "treasury" : action.purpose === "kol_payment" ? "kol" : action.purpose === "developer_bounty" ? "bounty" : action.purpose === "partner_incentive" ? "community" : "content";
  const pstate = await loadPolicyState(db, { projectId: p.projectId, missionId: action.missionId, category, experimentId: action.action === "send_payment" ? action.experimentId : undefined });
  const verdict = evaluatePolicy(action, policy, pstate);
  log("policy", `${action.action} ${fmtUsdc(verdict.amountMicro)} → ${verdict.verdict}`);
  const mode: Mode = "LIVE";

  const decision = await recordDecision(db, {
    projectId: p.projectId,
    missionId: action.missionId,
    runId: p.runId,
    agent: p.agent ?? "operator",
    kind: action.action,
    action: action as unknown as Record<string, unknown>,
    rationale: p.rationale,
    inputs: { reasons: p.reasons, confidenceBefore: action.confidence },
    policy: verdict,
    status: verdict.verdict === "ALLOW" ? "approved" : verdict.verdict === "DENY" ? "denied" : "awaiting_approval",
    autonomous: verdict.verdict === "ALLOW",
    dataMode: mode,
  });
  const isSend = action.action === "send_payment";
  const { tx, duplicate } = await createTransaction(db, {
    projectId: p.projectId,
    walletId: (await getWallet(db, p.projectId))?.id,
    decisionId: decision.id,
    missionId: action.missionId,
    experimentId: isSend ? (action as SendPaymentAction).experimentId : (action as BridgeFundsAction).experimentId ?? null,
    kind: isSend ? "send" : "bridge",
    rail: isSend ? "app_kit_send" : "app_kit_bridge",
    budgetCategory: category,
    amountMicro: verdict.amountMicro,
    chain: isSend ? (action as SendPaymentAction).chain : (action as BridgeFundsAction).fromChain,
    destChain: isSend ? null : (action as BridgeFundsAction).toChain,
    recipient: isSend ? (action as SendPaymentAction).recipient : null,
    idempotencyKey: sha256(`${p.projectId}:${canonicalJson(action)}`),
    dataMode: "LIVE",
  });
  if (duplicate) return { decisionId: tx.decisionId, verdict: verdict.verdict, state: tx.state, message: "Identical payment already proposed — duplicate prevented" };

  if (verdict.verdict === "DENY") {
    await transition(db, tx.id, "DENIED", {}, verdict.checks.filter((c) => !c.passed && c.severity === "deny").map((c) => c.rule).join(", "));
    await writeReceipt(db, decision.id);
    const blocking = verdict.checks.filter((c) => !c.passed && c.severity === "deny");
    return { decisionId: decision.id, verdict: "DENY", state: "DENIED", message: (blocking.length ? blocking : verdict.checks.filter((c) => !c.passed)).map((c) => c.detail).join("; ") };
  }
  if (verdict.verdict === "APPROVAL_REQUIRED") {
    await transition(db, tx.id, "AWAITING_APPROVAL");
    const [ap] = await db
      .insert(s.approvals)
      .values({
        id: newId(),
        projectId: p.projectId,
        decisionId: decision.id,
        transactionId: tx.id,
        title: p.title,
        details: {
          rationale: p.rationale,
          reasons: p.reasons,
          expectedOutcome: p.expectedOutcome ?? null,
          evidence: p.evidence ?? [],
          confidence: action.confidence,
          policy: verdict.checks.filter((c) => !c.passed).map((c) => ({ rule: c.rule, detail: c.detail })),
          action,
          ...p.details,
        },
        requestedMicro: verdict.amountMicro,
      })
      .returning({ id: s.approvals.id });
    await writeReceipt(db, decision.id);
    await notify(db, p.projectId, { event: "approval.requested", key: `approval.requested:${ap.id}`, summary: `Approval needed: ${p.title} (${verdict.amountMicro / 1_000_000} USDC)`, path: "/app/approvals", data: { approval_id: ap.id, amount_usdc: verdict.amountMicro / 1_000_000 } });
    log("policy", `Approval required: ${verdict.checks.filter((c) => !c.passed).map((c) => c.rule).join(", ")}`);
    return { decisionId: decision.id, verdict: "APPROVAL_REQUIRED", state: "AWAITING_APPROVAL", approvalId: ap.id, message: "Sent to Approval Inbox" };
  }
  await transition(db, tx.id, "AUTHORIZED", {}, "policy ALLOW");
  const r = await executeChainTx(db, tx.id, log);
  return { decisionId: decision.id, verdict: "ALLOW", state: r.state, txHash: r.txHash, message: r.message };
}

/** Execute an AUTHORIZED send/bridge via App Kit. */
export async function executeChainTx(db: DB, txId: string, log: Logger = () => {}): Promise<{ state: string; txHash: string | null; message: string }> {
  const claim = await claimExecution(db, txId);
  if (!claim.claimed) return { state: claim.state, txHash: null, message: claim.message };
  const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
  const amount = microToDecimal(tx.amountMicro);

  if (tx.chain !== ARC.appKitChain || tx.kind !== "send" || !tx.recipient || !/^0x[0-9a-fA-F]{40}$/.test(tx.recipient)) {
    const message = "This transaction is not an Arc mainnet payment";
    await transition(db, txId, "FAILED", { error: message }, message);
    await finish(db, tx, "FAILED", null);
    return { state: "FAILED", txHash: null, message };
  }

  const wallet = await getWallet(db, tx.projectId);
  if (!walletIsLive(wallet) || wallet!.frozen) {
    await transition(db, txId, "FAILED", { error: "No agent wallet configured" });
    await finish(db, tx, "FAILED", null);
    return { state: "FAILED", txHash: null, message: "No agent wallet configured" };
  }

  try {
    const res = await appKitSend(wallet!, { chain: tx.chain, to: tx.recipient, amount });
    const patch = { txHash: res.txHash, explorerUrl: res.explorerUrl ?? (res.txHash ? txExplorerUrl(tx.chain, res.txHash) : null), error: res.state === "error" ? "App Kit reported error" : null };
    const steps = `App Kit ${tx.kind}: ${res.steps.map((st) => `${st.name}=${st.state}`).join(", ")}`;
    let state: string;
    if (res.state === "error") {
      state = "FAILED";
      await transition(db, txId, "FAILED", patch, steps);
    } else {
      await transition(db, txId, "SUBMITTED", patch, steps);
      // Settled only once Arc shows the approved amount reaching the approved address.
      state = res.state === "success" ? await confirmSend(db, txId) : "SUBMITTED";
    }
    await finish(db, tx, state, res.txHash);
    log("operator", `App Kit ${tx.kind} ${fmtUsdc(tx.amountMicro)} → ${state}${res.txHash ? ` (${res.txHash.slice(0, 10)}…)` : ""}`);
    return { state, txHash: res.txHash, message: `App Kit ${tx.kind} ${state.toLowerCase()}` };
  } catch (e) {
    const msg = (e as Error).message;
    const [current] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
    // The provider already submitted this payout. An RPC/receipt-write outage must never
    // make its committed amount disappear or let the founder pay the same work again.
    if (current && ["SUBMITTED", "SETTLED"].includes(current.state)) {
      await finish(db, current, current.state, current.txHash);
      return { state: current.state, txHash: current.txHash, message: `Payment sent; confirmation pending: ${msg}` };
    }
    await transition(db, txId, "FAILED", { error: msg }, msg);
    await finish(db, tx, "FAILED", null);
    log("operator", `App Kit ${tx.kind} failed: ${msg}`);
    return { state: "FAILED", txHash: null, message: msg };
  }
}

/** A payment that didn't go out leaves its experiment where it was: running if something was paid, otherwise proposed. */
async function reopenExperiment(db: DB, experimentId: string) {
  const paid = await experimentSpend(db, experimentId);
  await db
    .update(s.experiments)
    .set({ status: paid > 0 ? "running" : "proposed", updatedAt: new Date() })
    .where(and(eq(s.experiments.id, experimentId), eq(s.experiments.status, "awaiting_approval")));
}

async function finish(db: DB, tx: typeof s.transactions.$inferSelect, state: string, txHash: string | null) {
  await updateDecision(db, tx.decisionId, { status: state === "FAILED" ? "failed" : "executed", result: { state, txHash } });
  if (tx.experimentId && state === "FAILED") await reopenExperiment(db, tx.experimentId);
  // A paid experiment starts running once its payment has gone out.
  if (tx.experimentId && (state === "SETTLED" || state === "SUBMITTED")) {
    await db.update(s.experiments).set({ status: "running", startsAt: new Date(), updatedAt: new Date() }).where(and(eq(s.experiments.id, tx.experimentId), inArray(s.experiments.status, ["proposed", "awaiting_approval"])));
  }
  await writeReceipt(db, tx.decisionId);
}

/** Founder resolves an Approval Inbox item. Approval waives approval-level rules only; deny rules are re-checked. */
export async function resolveApproval(db: DB, a: { approvalId: string; userId: string; resolution: "approve" | "reject"; modifiedAmount?: string; note?: string; log?: Logger }): Promise<{ status: "approved" | "rejected" | "denied"; state?: string; txHash?: string | null; reason?: string }> {
  const plan = await db.transaction(async (tx) => {
    const [ap] = await tx.select({ projectId: s.approvals.projectId }).from(s.approvals).where(eq(s.approvals.id, a.approvalId));
    if (!ap) throw new Error("approval not found");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${ap.projectId}`}))`);
    return resolveApprovalPlan(tx as unknown as DB, a);
  });
  if (!("execute" in plan) || !plan.execute) return plan;
  const { tx, decision, action, projectId, amountMicro } = plan.execute;
  if (tx.kind === "x402_purchase" && action.action === "purchase_service") {
    let q: Awaited<ReturnType<typeof quote>> | null = null;
    try { q = await quote(action.resourceUrl); } catch { q = null; }
    const r = await executePurchase(db, { txId: tx.id, decisionId: decision.id, projectId, companyId: action.subject.id, url: action.resourceUrl, liveQuote: q, priceMicro: amountMicro, before: action.confidence, serviceId: action.serviceId, purpose: "Founder-approved data purchase", log: a.log });
    return { status: "approved" as const, state: r.state };
  }
  const r = await executeChainTx(db, tx.id, a.log);
  return { status: "approved" as const, state: r.state, txHash: r.txHash };
}

async function resolveApprovalPlan(db: DB, a: Parameters<typeof resolveApproval>[1]) {
  const log = a.log ?? (() => {});
  const [ap] = await db.select().from(s.approvals).where(eq(s.approvals.id, a.approvalId));
  if (!ap) throw new Error("approval not found");
  if (ap.status !== "pending") throw new Error(`approval already ${ap.status}`);
  const [decision] = await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.id, ap.decisionId));
  const [tx] = ap.transactionId ? await db.select().from(s.transactions).where(eq(s.transactions.id, ap.transactionId)) : [];

  if (a.resolution === "reject") {
    await db.update(s.approvals).set({ status: "rejected", resolvedBy: a.userId, resolvedAt: new Date(), note: a.note ?? null }).where(eq(s.approvals.id, ap.id));
    if (tx) await transition(db, tx.id, "REJECTED", {}, `rejected by founder${a.note ? `: ${a.note}` : ""}`);
    await updateDecision(db, decision.id, { status: "rejected" });
    if (tx?.experimentId) await reopenExperiment(db, tx.experimentId);
    await writeReceipt(db, decision.id);
    await audit(db, { projectId: ap.projectId, actorType: "user", actorId: a.userId, action: "approval.reject", target: ap.id });
    return { status: "rejected" as const };
  }

  // Payee controls: the address hasn't changed since this was proposed, and whoever just replaced it isn't the one approving.
  if (tx?.kind === "send") await assertPayeeApprovable(db, tx, a.userId);

  // Optional modification: the founder may lower (never raise) the amount.
  let action = decision.action as Record<string, unknown>;
  if (a.modifiedAmount) {
    const m = toMicro(a.modifiedAmount);
    if (m <= 0 || m > ap.requestedMicro) throw new Error("Modified amount must be positive and not exceed the requested amount");
    action = { ...action, amount: microToDecimal(m) };
  }
  const parsed = parseFinancialAction(action);
  if (!parsed.success) throw new Error("Modified action failed validation");
  if (parsed.data.action === "send_payment") await assertCreatorReward(db, ap.projectId, parsed.data, tx?.id);
  const policy = await loadPolicy(db, ap.projectId);
  const missionId = "missionId" in parsed.data ? parsed.data.missionId : decision.missionId!;
  const reallocationExperiments = parsed.data.action === "reallocate_budget" ? await db.select().from(s.experiments).where(and(eq(s.experiments.projectId, ap.projectId), eq(s.experiments.missionId, missionId))) : [];
  const remaining: Record<string, number> = {};
  for (const e of reallocationExperiments) {
    const committed = (await db.select({ total: sql<string>`coalesce(sum(${s.transactions.amountMicro}), 0)` }).from(s.transactions).where(and(eq(s.transactions.experimentId, e.id), inArray(s.transactions.state, ["PROPOSED", "AWAITING_APPROVAL", "AUTHORIZED", "EXECUTING", "SUBMITTED", "SETTLED"]))))[0];
    remaining[e.id] = Math.max(0, e.budgetMicro - Number(committed.total));
  }
  const pstate = await loadPolicyState(db, { projectId: ap.projectId, missionId, category: tx?.budgetCategory ?? "research", experimentId: parsed.data.action === "send_payment" ? parsed.data.experimentId : undefined, excludeTxId: tx?.id, serviceKnown: true, experimentRemainingMicro: remaining });
  const verdict = evaluatePolicy(parsed.data, policy, pstate, { founderApproved: true });
  log("policy", `Re-checked after approval → ${verdict.verdict}`);

  await db.update(s.approvals).set({ status: verdict.verdict === "DENY" ? "rejected" : "approved", approvedMicro: verdict.verdict === "DENY" ? null : verdict.amountMicro, resolvedBy: a.userId, resolvedAt: new Date(), note: a.note ?? null }).where(eq(s.approvals.id, ap.id));
  await audit(db, { projectId: ap.projectId, actorType: "user", actorId: a.userId, action: verdict.verdict === "DENY" ? "approval.denied_by_policy" : "approval.approve", target: ap.id, data: { amountMicro: verdict.amountMicro, modified: !!a.modifiedAmount } });
  await updateDecision(db, decision.id, { action, policyVerdict: verdict.verdict, policyChecks: verdict.checks.map((c) => ({ rule: c.rule, passed: c.passed, detail: c.detail })), status: verdict.verdict === "DENY" ? "denied" : "approved", autonomous: false });

  if (!tx) {
    // Budget reallocation: no funds move, only experiment budgets change.
    if (decision.kind === "reallocate_budget" && verdict.verdict !== "DENY" && parsed.data.action === "reallocate_budget") {
      await applyReallocation(db, ap.projectId, parsed.data.missionId, decision.id, parsed.data.moves, (ap.details as { findings?: unknown[] }).findings ?? []);
      await updateDecision(db, decision.id, { status: "executed" });
    }
    await writeReceipt(db, decision.id);
    return { status: verdict.verdict === "DENY" ? ("denied" as const) : ("approved" as const) };
  }
  if (verdict.verdict === "DENY") {
    await transition(db, tx.id, "DENIED", {}, "deny rule failed at approval re-check");
    if (tx.experimentId) await reopenExperiment(db, tx.experimentId);
    await writeReceipt(db, decision.id);
    return { status: "denied" as const, reason: verdict.checks.filter((c) => !c.passed && c.severity === "deny").map((c) => c.detail).join("; ") };
  }
  if (a.modifiedAmount) await db.update(s.transactions).set({ amountMicro: verdict.amountMicro }).where(eq(s.transactions.id, tx.id));
  await transition(db, tx.id, "AUTHORIZED", {}, "founder approved");

  return { status: "approved" as const, execute: { tx, decision, action: parsed.data, projectId: ap.projectId, amountMicro: verdict.amountMicro } };
}

/**
 * Follow settlement lifecycle. x402: Gateway transfer received → batched → confirmed/completed,
 * then resolve the Arc submitBatch tx. App Kit: wait for the on-chain receipt.
 */
export async function refreshSettlements(db: DB, projectId: string): Promise<{ checked: number; updated: number; errors: string[] }> {
  const pending = await db.select().from(s.transactions).where(and(eq(s.transactions.projectId, projectId), eq(s.transactions.state, "SUBMITTED")));
  let updated = 0;
  const errors: string[] = [];
  for (const tx of pending) {
    try {
      if (tx.rail === "gateway_x402" && tx.settlementId) {
        const st = await getSettlement(tx.settlementId);
        if (st.status !== tx.settlementStatus) {
          await db.update(s.transactions).set({ settlementStatus: st.status, updatedAt: new Date() }).where(eq(s.transactions.id, tx.id));
          await db.insert(s.transactionEvents).values({ id: newId(), transactionId: tx.id, fromState: tx.state, toState: tx.state, note: `Gateway settlement status: ${st.status}` });
          updated++;
        }
        if (st.status === "completed" || st.status === "confirmed") {
          const batch = await resolveBatchTx(st);
          await transition(db, tx.id, "SETTLED", { settlementStatus: st.status, batchTxHash: batch, explorerUrl: batch ? txExplorerUrl(tx.chain, batch) : null }, batch ? `Batched on Arc in ${batch}` : "Settled (batch tx not yet indexed)");
        } else if (st.status === "failed") await transition(db, tx.id, "FAILED", { settlementStatus: "failed", error: "Gateway settlement failed" });
      } else if (tx.kind === "send") {
        const state = await confirmSend(db, tx.id);
        if (state !== "SUBMITTED") {
          await finish(db, tx, state, tx.txHash);
          updated++;
          continue; // finish() already wrote the receipt
        }
      } else if (tx.txHash) {
        const chain = tx.kind === "bridge" && tx.destChain ? tx.destChain : tx.chain;
        const client = createPublicClient({ transport: http(CHAINS[chain]?.rpc ?? ARC.rpcUrl) });
        const rc = await client.getTransactionReceipt({ hash: tx.txHash as Hex }).catch(() => null);
        if (rc) {
          await transition(db, tx.id, rc.status === "success" ? "SETTLED" : "FAILED", {}, `receipt status ${rc.status} in block ${rc.blockNumber}`);
          updated++;
        }
      }
      await writeReceipt(db, tx.decisionId);
    } catch (e) {
      errors.push(`${tx.id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  return { checked: pending.length, updated, errors };
}
