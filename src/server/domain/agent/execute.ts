import { and, eq, inArray } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId, sha256, canonicalJson } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { ARC, CHAINS, txExplorerUrl, type AppKitChain } from "@/server/integrations/circle/config";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { appKitBridge, appKitSend } from "@/server/integrations/circle/appkit";
import { getSettlement, resolveBatchTx } from "@/server/integrations/circle/gateway";
import { quote } from "@/server/integrations/circle/x402";
import type { Logger } from "@/server/domain/intel/analyze";
import { parseFinancialAction, type SendPaymentAction, type BridgeFundsAction } from "@/server/domain/agent/actions";
import { evaluatePolicy, isBlockedRecipient } from "@/server/domain/agent/policy";
import { createTransaction, loadPolicy, loadPolicyState, transition, type TxState } from "@/server/domain/agent/ledger";
import { recordDecision, updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { executePurchase } from "@/server/domain/agent/purchase";
import { applyReallocation } from "@/server/domain/growth/learning-run";

type Mode = (typeof s.dataMode.enumValues)[number];

export interface ProposalOutcome {
  /** Null when nothing was proposed (duplicate, or no valid recipient). */
  decisionId: string | null;
  verdict: "ALLOW" | "APPROVAL_REQUIRED" | "DENY" | "NOT_PROPOSED";
  state: string;
  approvalId?: string;
  txHash?: string | null;
  message: string;
}

/** Earlier attempts in these states never moved funds, so the same payout may be proposed again. */
const RETRYABLE: TxState[] = ["DENIED", "REJECTED"];

/**
 * Idempotency key for a proposal, plus the existing transaction if this payment was already proposed.
 * A send with a payoutRef (e.g. "tranche:2") is keyed by experiment + ref, so it can be paid at most once
 * (a new attempt is allowed only after a DENIED/REJECTED one); everything else by its canonical action.
 */
async function idempotency(db: DB, projectId: string, action: SendPaymentAction | BridgeFundsAction) {
  if (action.action === "send_payment" && action.payoutRef) {
    const prior = await db
      .select({ tx: s.transactions, action: s.agentDecisions.action })
      .from(s.transactions)
      .innerJoin(s.agentDecisions, eq(s.transactions.decisionId, s.agentDecisions.id))
      .where(and(eq(s.transactions.projectId, projectId), eq(s.transactions.experimentId, action.experimentId), eq(s.transactions.kind, "send")));
    const same = prior.filter((r) => (r.action as { payoutRef?: string }).payoutRef === action.payoutRef).map((r) => r.tx);
    const live = same.find((t) => !RETRYABLE.includes(t.state as TxState));
    return { key: live?.idempotencyKey ?? sha256(`${projectId}:payout:${action.experimentId}:${action.payoutRef}:${same.length}`), existing: live };
  }
  const key = sha256(`${projectId}:${canonicalJson(action)}`);
  const [existing] = await db.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, key));
  return { key, existing };
}

/**
 * Propose a money movement (send or bridge). It goes through Zod → policy → either executes,
 * lands in the Approval Inbox, or is denied. Free text never reaches this function.
 */
export async function proposeFinancialAction(
  db: DB,
  p: { projectId: string; input: unknown; rationale: string; reasons: string[]; title: string; runId?: string | null; agent?: string; expectedOutcome?: string; evidence?: { url: string; title: string }[]; log?: Logger },
): Promise<ProposalOutcome> {
  const log = p.log ?? (() => {});
  const parsed = parseFinancialAction(p.input);
  if (!parsed.success) throw new Error(`Rejected by schema validator: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const action = parsed.data;
  if (action.action !== "send_payment" && action.action !== "bridge_funds") throw new Error("proposeFinancialAction handles send_payment and bridge_funds");

  // Duplicate check first, so a repeated proposal leaves no orphan decision behind.
  const idem = await idempotency(db, p.projectId, action);
  if (idem.existing) {
    const msg = idem.existing.state === "FAILED" ? "An earlier attempt of this payment FAILED — review its receipt before paying again" : "Identical payment already proposed — duplicate prevented";
    log("policy", msg);
    return { decisionId: idem.existing.decisionId, verdict: "NOT_PROPOSED", state: idem.existing.state, message: msg };
  }

  const policy = await loadPolicy(db, p.projectId);
  const category = action.action === "bridge_funds" ? "treasury" : action.purpose === "kol_payment" ? "kol" : action.purpose === "developer_bounty" ? "bounty" : action.purpose === "partner_incentive" ? "community" : "content";
  const pstate = await loadPolicyState(db, { projectId: p.projectId, missionId: action.missionId, category, chain: action.action === "bridge_funds" ? action.fromChain : action.chain });
  const verdict = evaluatePolicy(action, policy, pstate);
  log("policy", `${action.action} ${fmtUsdc(verdict.amountMicro)} → ${verdict.verdict}`);
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, p.projectId));
  const mode: Mode = pstate.simulation ? "SIMULATED" : project?.dataMode === "DEMO" ? "DEMO" : ARC.dataMode;

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
    idempotencyKey: idem.key,
    dataMode: pstate.simulation ? "SIMULATED" : ARC.dataMode,
  });
  if (duplicate) {
    // Lost a race with a concurrent proposal: record why this decision went nowhere.
    await updateDecision(db, decision.id, { status: "duplicate", result: { duplicateOf: tx.decisionId } });
    await writeReceipt(db, decision.id);
    return { decisionId: tx.decisionId, verdict: "NOT_PROPOSED", state: tx.state, message: "Identical payment already proposed — duplicate prevented" };
  }

  if (verdict.verdict === "DENY") {
    await transition(db, tx.id, "DENIED", {}, verdict.checks.filter((c) => !c.passed && c.severity === "deny").map((c) => c.rule).join(", "));
    await writeReceipt(db, decision.id);
    return { decisionId: decision.id, verdict: "DENY", state: "DENIED", message: verdict.checks.filter((c) => !c.passed).map((c) => c.detail).join("; ") };
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
        },
        requestedMicro: verdict.amountMicro,
      })
      .returning({ id: s.approvals.id });
    await writeReceipt(db, decision.id);
    log("policy", `Approval required: ${verdict.checks.filter((c) => !c.passed).map((c) => c.rule).join(", ")}`);
    return { decisionId: decision.id, verdict: "APPROVAL_REQUIRED", state: "AWAITING_APPROVAL", approvalId: ap.id, message: "Sent to Approval Inbox" };
  }
  await transition(db, tx.id, "AUTHORIZED", {}, "policy ALLOW");
  const r = await executeChainTx(db, tx.id, log);
  return { decisionId: decision.id, verdict: "ALLOW", state: r.state, txHash: r.txHash, message: r.message };
}

/** Execute an AUTHORIZED send/bridge via App Kit. */
export async function executeChainTx(db: DB, txId: string, log: Logger = () => {}): Promise<{ state: string; txHash: string | null; message: string }> {
  if (!(await transition(db, txId, "EXECUTING", {}, "execution lock acquired"))) return { state: "LOCKED", txHash: null, message: "Already executing" };
  const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.id, txId));
  const [project] = await db.select().from(s.projects).where(eq(s.projects.id, tx.projectId));
  const amount = microToDecimal(tx.amountMicro);

  const wallet = await getWallet(db, tx.projectId);
  if (!walletIsLive(wallet) || wallet!.frozen) {
    const why = !wallet ? "No agent wallet configured" : wallet.frozen ? "Wallet frozen (kill switch on)" : "Wallet cannot sign on this deployment";
    if (project.dataMode === "DEMO") {
      await transition(db, txId, "SIMULATED", { error: `${why} — simulation only` }, `${why}: SIMULATED`);
      await finish(db, tx, "SIMULATED", null);
      log("operator", `SIMULATED ${tx.kind} of ${fmtUsdc(tx.amountMicro)} (${why}) — nothing moved on ${ARC.name}`);
      return { state: "SIMULATED", txHash: null, message: `Simulated (${why.toLowerCase()})` };
    }
    await transition(db, txId, "FAILED", { error: why });
    await finish(db, tx, "FAILED", null);
    return { state: "FAILED", txHash: null, message: why };
  }
  // Last line of defence: never broadcast to a placeholder/burn address.
  if (tx.kind === "send" && isBlockedRecipient(tx.recipient)) {
    await transition(db, txId, "FAILED", { error: "Refused: placeholder/burn recipient" });
    await finish(db, tx, "FAILED", null);
    return { state: "FAILED", txHash: null, message: "Refused: placeholder/burn recipient" };
  }

  try {
    const res = tx.kind === "bridge" ? await appKitBridge(wallet!, { fromChain: tx.chain, toChain: tx.destChain!, amount }) : await appKitSend(wallet!, { chain: tx.chain, to: tx.recipient!, amount });
    const state = res.state === "success" ? "SETTLED" : res.state === "error" ? "FAILED" : "SUBMITTED";
    await transition(db, txId, state, { txHash: res.txHash, explorerUrl: res.explorerUrl ?? (res.txHash ? txExplorerUrl(tx.chain, res.txHash) : null), error: res.state === "error" ? "App Kit reported error" : null }, `App Kit ${tx.kind}: ${res.steps.map((st) => `${st.name}=${st.state}`).join(", ")}`);
    await finish(db, tx, state, res.txHash);
    log("operator", `App Kit ${tx.kind} ${fmtUsdc(tx.amountMicro)} → ${state}${res.txHash ? ` (${res.txHash.slice(0, 10)}…)` : ""}`);
    return { state, txHash: res.txHash, message: `App Kit ${tx.kind} ${state.toLowerCase()}` };
  } catch (e) {
    const msg = (e as Error).message;
    await transition(db, txId, "FAILED", { error: msg }, msg);
    await finish(db, tx, "FAILED", null);
    log("operator", `App Kit ${tx.kind} failed: ${msg}`);
    return { state: "FAILED", txHash: null, message: msg };
  }
}

async function finish(db: DB, tx: typeof s.transactions.$inferSelect, state: string, txHash: string | null) {
  await updateDecision(db, tx.decisionId, { status: state === "FAILED" ? "failed" : "executed", result: { state, txHash } });
  // A paid experiment starts running once its payment has gone out.
  if (tx.experimentId && (state === "SETTLED" || state === "SUBMITTED" || state === "SIMULATED")) {
    await db.update(s.experiments).set({ status: "running", startsAt: new Date(), updatedAt: new Date() }).where(and(eq(s.experiments.id, tx.experimentId), inArray(s.experiments.status, ["proposed", "awaiting_approval"])));
  }
  await writeReceipt(db, tx.decisionId);
}

export type ApprovalResolution = { status: "approved" | "rejected" | "denied"; state?: string; txHash?: string | null; reason?: string };

/**
 * Founder resolves an Approval Inbox item. Approval waives approval-level rules only; deny rules are
 * re-checked first. The decision keeps its original policy verdict; the re-check is stored beside it.
 */
export async function resolveApproval(db: DB, a: { approvalId: string; userId: string; resolution: "approve" | "reject"; modifiedAmount?: string; note?: string; log?: Logger }): Promise<ApprovalResolution> {
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
    if (tx?.experimentId) await db.update(s.experiments).set({ status: "stopped", updatedAt: new Date() }).where(eq(s.experiments.id, tx.experimentId));
    await writeReceipt(db, decision.id);
    await audit(db, { projectId: ap.projectId, actorType: "user", actorId: a.userId, action: "approval.reject", target: ap.id });
    return { status: "rejected" };
  }

  // Optional modification: the founder may lower (never raise) a send or bridge. An x402 price is the
  // seller's quote and a reallocation is a set of moves, so those are approved or rejected as proposed.
  let action = decision.action as Record<string, unknown>;
  if (a.modifiedAmount) {
    if (!tx || tx.kind === "x402_purchase" || tx.kind === "gateway_deposit") throw new Error("This request can't be reduced — approve or reject it as proposed");
    const m = toMicro(a.modifiedAmount);
    if (m <= 0 || m > ap.requestedMicro) throw new Error("Modified amount must be positive and not exceed the requested amount");
    action = { ...action, amount: microToDecimal(m) };
  }
  const parsed = parseFinancialAction(action);
  if (!parsed.success) throw new Error("Modified action failed validation");
  const policy = await loadPolicy(db, ap.projectId);
  const missionId = "missionId" in parsed.data ? parsed.data.missionId : decision.missionId!;
  const chain = parsed.data.action === "bridge_funds" ? parsed.data.fromChain : parsed.data.action === "reallocate_budget" ? undefined : parsed.data.chain;
  const pstate = await loadPolicyState(db, { projectId: ap.projectId, missionId, category: tx?.budgetCategory ?? "treasury", excludeTxId: tx?.id, serviceKnown: true, balances: !!tx, chain });
  const verdict = evaluatePolicy(parsed.data, policy, pstate, { founderApproved: true });
  const denied = verdict.verdict === "DENY";
  const reason = verdict.checks.filter((c) => !c.passed && c.severity === "deny").map((c) => c.detail).join("; ");
  log("policy", `Re-checked after approval → ${verdict.verdict}${denied ? `: ${reason}` : ""}`);

  // Branch on the re-check before recording anything: a denied re-check is not an approval.
  await db
    .update(s.approvals)
    .set({ status: denied ? "denied" : "approved", approvedMicro: denied ? null : verdict.amountMicro, resolvedBy: a.userId, resolvedAt: new Date(), note: a.note ?? null })
    .where(eq(s.approvals.id, ap.id));
  await audit(db, { projectId: ap.projectId, actorType: "user", actorId: a.userId, action: denied ? "approval.denied_at_recheck" : "approval.approve", target: ap.id, data: { amountMicro: verdict.amountMicro, modified: !!a.modifiedAmount } });
  const approvalRecheck = { verdict: verdict.verdict, checks: verdict.checks.map((c) => ({ rule: c.rule, passed: c.passed, detail: c.detail })), at: new Date().toISOString(), amountMicro: verdict.amountMicro, modified: !!a.modifiedAmount };
  await updateDecision(db, decision.id, { action, inputs: { ...(decision.inputs as Record<string, unknown>), approvalRecheck }, status: denied ? "denied" : "approved", autonomous: false });

  if (!tx) {
    // Budget reallocation: no funds move, only experiment budgets change.
    if (decision.kind === "reallocate_budget" && !denied && parsed.data.action === "reallocate_budget") {
      await applyReallocation(db, ap.projectId, parsed.data.missionId, decision.id, parsed.data.moves, (ap.details as { findings?: unknown[] }).findings ?? []);
      await updateDecision(db, decision.id, { status: "executed" });
    }
    await writeReceipt(db, decision.id);
    return denied ? { status: "denied", reason } : { status: "approved", state: decision.kind === "reallocate_budget" ? "APPLIED" : undefined };
  }
  if (denied) {
    await transition(db, tx.id, "DENIED", {}, `deny rule failed at approval re-check: ${reason}`);
    if (tx.experimentId) await db.update(s.experiments).set({ status: "proposed", updatedAt: new Date() }).where(and(eq(s.experiments.id, tx.experimentId), eq(s.experiments.status, "awaiting_approval")));
    await writeReceipt(db, decision.id);
    return { status: "denied", state: "DENIED", reason };
  }
  if (a.modifiedAmount) await db.update(s.transactions).set({ amountMicro: verdict.amountMicro }).where(eq(s.transactions.id, tx.id));
  await transition(db, tx.id, "AUTHORIZED", {}, "founder approved");

  if (tx.kind === "x402_purchase") {
    const act = parsed.data as { resourceUrl: string; serviceId: string; subject: { id: string }; confidence: number };
    let q: Awaited<ReturnType<typeof quote>> | null = null;
    try {
      q = await quote(act.resourceUrl);
    } catch {
      q = null;
    }
    const r = await executePurchase(db, { txId: tx.id, decisionId: decision.id, projectId: ap.projectId, companyId: act.subject.id, url: act.resourceUrl, liveQuote: q, priceMicro: verdict.amountMicro, before: act.confidence, serviceId: act.serviceId, purpose: "Founder-approved data purchase", log });
    return { status: "approved", state: r.state, reason: r.state === "FAILED" ? r.message : undefined };
  }
  const r = await executeChainTx(db, tx.id, log);
  return { status: "approved", state: r.state, txHash: r.txHash, reason: r.state === "FAILED" ? r.message : undefined };
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
          await transition(db, tx.id, "SETTLED", { settlementStatus: st.status, batchTxHash: batch, explorerUrl: batch ? txExplorerUrl(ARC.appKitChain, batch) : null }, batch ? `Batched on Arc in ${batch}` : "Settled (batch tx not yet indexed)");
        } else if (st.status === "failed") await transition(db, tx.id, "FAILED", { settlementStatus: "failed", error: "Gateway settlement failed" });
      } else if (tx.txHash) {
        const chain = tx.kind === "bridge" && tx.destChain ? tx.destChain : tx.chain;
        const client = createPublicClient({ transport: http(CHAINS[chain as AppKitChain]?.rpc || ARC.rpcUrl) });
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
