import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mergeMode } from "@/server/db/helpers";
import { canonicalJson, newId, sha256 } from "@/server/lib/ids";
import { fmtUsdc, microToDecimal, toMicro } from "@/lib/money";
import { ARC } from "@/server/integrations/circle/config";
import { signerFor } from "@/server/integrations/circle/signer";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { quote, pay } from "@/server/integrations/circle/x402";
import { servicesWithCapability, registerBundledSignalsService } from "@/server/integrations/circle/marketplace";
import { demoCompanyIntel, demoCreatorAudience, type EnrichmentSignal } from "@/server/demo/enrichment";
import { analyzeProject, type Logger } from "@/server/domain/intel/analyze";
import { evaluateInformationValue } from "@/server/domain/agent/information-value";
import { parseFinancialAction } from "@/server/domain/agent/actions";
import { evaluatePolicy } from "@/server/domain/agent/policy";
import { createTransaction, loadPolicy, loadPolicyState, transition } from "@/server/domain/agent/ledger";
import { recordDecision, updateDecision, writeReceipt } from "@/server/domain/agent/decisions";
import { notifyApproval } from "@/server/domain/notifications/webhooks";

/**
 * x402 AUTONOMOUS PURCHASING
 *
 *  need identified → find x402 service → live price quote → expected value of information
 *  → structured action (Zod) → policy engine → pay via Circle Gateway (x402) → consume data
 *  → re-score → record receipt
 */

export interface PurchaseOutcome {
  decisionId: string;
  bought: boolean;
  state: string;
  confidenceBefore: number;
  confidenceAfter: number | null;
  priceMicro: number | null;
  settlementId: string | null;
  message: string;
}

/** How much a company-enrichment purchase is expected to move confidence, and how reliable it has been. */
const EXPECTED_LIFT = { company_enrichment: 0.2, creator_audience: 0.15 };

export async function purchaseCompanyIntel(db: DB, p: { projectId: string; companyId: string; runId?: string | null; log?: Logger }): Promise<PurchaseOutcome> {
  const log = p.log ?? (() => {});
  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, p.companyId));
  if (!company) throw new Error("company not found");
  const [mission] = await db.select().from(s.missions).where(and(eq(s.missions.projectId, p.projectId), eq(s.missions.status, "active")));
  if (!mission) throw new Error("No active mission — purchases are always tied to a mission budget");
  const [opp] = await db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, p.projectId), eq(s.opportunities.subjectKey, `company:${company.id}`)));
  const policy = await loadPolicy(db, p.projectId);

  const before = company.confidence;
  const stake = Math.max(opp?.estimatedCostMicro ?? 0, toMicro(25));
  log("operator", `${company.name}: confidence ${(before * 100).toFixed(0)}% — evaluating whether more information is worth buying`);

  // 1. Discover a service that can answer the question.
  await registerBundledSignalsService(db);
  const candidates = (await servicesWithCapability(db, "company_enrichment")).sort((a, b) => (a.svc.priceMicro ?? 1e12) - (b.svc.priceMicro ?? 1e12));
  const pick = candidates.find((c) => c.svc.network === ARC.caip2) ?? candidates[0];
  if (!pick) throw new Error("No company-enrichment service in the catalog");
  log("operator", `Found ${pick.vendor.name} (${pick.vendor.source === "circle_marketplace" ? "Circle Agent Marketplace" : "bundled x402 seller"}) — listed at ${fmtUsdc(pick.svc.priceMicro)}`);

  // 2. Live quote from the seller's 402 challenge (the price we evaluate is the price we'd pay).
  const url = new URL(pick.svc.resourceUrl);
  url.searchParams.set("company", company.name);
  if (company.githubOrg) url.searchParams.set("github", company.githubOrg);
  let liveQuote: Awaited<ReturnType<typeof quote>> | null = null;
  let quoteError: string | null = null;
  try {
    liveQuote = await quote(url.toString());
    if (liveQuote.kind !== "quote") quoteError = liveQuote.kind === "unsupported" ? liveQuote.reason : "endpoint did not require payment";
  } catch (e) {
    quoteError = (e as Error).message;
  }
  const priceMicro = liveQuote?.kind === "quote" ? liveQuote.quote.amountMicro : pick.svc.priceMicro ?? toMicro(0.01);
  if (quoteError) log("operator", `Live quote unavailable (${quoteError}) — using listed price ${fmtUsdc(priceMicro)}`);

  // 3. Is it worth it?
  const ivi = evaluateInformationValue({ confidence: before, stakeMicro: stake, priceMicro, expectedLift: EXPECTED_LIFT.company_enrichment, reliability: 0.8, maxPerCallMicro: policy.maxTransactionMicro });
  const reasons = [...ivi.reasons];
  const projectMode = (await db.select({ m: s.projects.dataMode }).from(s.projects).where(eq(s.projects.id, p.projectId)))[0]?.m ?? "LIVE";

  if (!ivi.buy) {
    const d = await recordDecision(db, {
      projectId: p.projectId,
      missionId: mission.id,
      runId: p.runId,
      agent: "operator",
      kind: "skip_purchase",
      action: { action: "skip_purchase", serviceId: pick.svc.id, quotedPriceMicro: priceMicro },
      rationale: `Not worth buying data on ${company.name}: expected value ${fmtUsdc(ivi.eviMicro)} vs price ${fmtUsdc(priceMicro)}.`,
      inputs: { confidenceBefore: before, reasons, eviMicro: ivi.eviMicro },
      status: "executed",
      dataMode: projectMode,
    });
    await writeReceipt(db, d.id);
    log("operator", `Decided NOT to buy: ${reasons[3]}`);
    return { decisionId: d.id, bought: false, state: "SKIPPED", confidenceBefore: before, confidenceAfter: null, priceMicro, settlementId: null, message: "Information not worth its price" };
  }
  log("operator", `Worth buying: ${reasons[3]}`);

  // 4. Structured action → Zod → policy engine.
  const parsed = parseFinancialAction({
    action: "purchase_service",
    serviceId: pick.svc.id,
    resourceUrl: url.toString(),
    amount: microToDecimal(priceMicro),
    currency: "USDC",
    reasonCode: "VERIFY_CUSTOMER_INTENT",
    expectedValue: ivi.expectedValue,
    missionId: mission.id,
    confidence: before,
    subject: { type: "company", id: company.id },
    chain: ARC.appKitChain,
  });
  if (!parsed.success) throw new Error(`Action failed schema validation: ${parsed.error.message}`);
  const action = parsed.data;
  // Duplicate check before any decision is recorded, so a repeat leaves no orphan decision.
  const idempotencyKey = sha256(`x402:${p.projectId}:${company.id}:${pick.svc.id}:${new Date().toISOString().slice(0, 13)}`);
  const [dup] = await db.select().from(s.transactions).where(eq(s.transactions.idempotencyKey, idempotencyKey));
  if (dup) {
    log("operator", "Same purchase already made this hour — idempotency key matched; not paying twice");
    return { decisionId: dup.decisionId, bought: false, state: dup.state, confidenceBefore: before, confidenceAfter: null, priceMicro, settlementId: dup.settlementId, message: "Duplicate purchase prevented" };
  }
  const pstate = await loadPolicyState(db, { projectId: p.projectId, missionId: mission.id, category: "research", serviceKnown: true, chain: ARC.appKitChain });
  const verdict = evaluatePolicy(action, policy, pstate);
  log("policy", `purchase_service ${fmtUsdc(priceMicro)} → ${verdict.verdict}`);

  const simulated = pstate.simulation;
  const decision = await recordDecision(db, {
    projectId: p.projectId,
    missionId: mission.id,
    runId: p.runId,
    agent: "operator",
    kind: "purchase_service",
    action: action as unknown as Record<string, unknown>,
    rationale: `Customer-intent confidence for ${company.name} was ${(before * 100).toFixed(0)}%. ${pick.vendor.name} can verify hiring, funding and adoption signals for ${fmtUsdc(priceMicro)}.`,
    inputs: { confidenceBefore: before, reasons, eviMicro: ivi.eviMicro, quoteError },
    policy: verdict,
    status: verdict.verdict === "ALLOW" ? "approved" : verdict.verdict === "DENY" ? "denied" : "awaiting_approval",
    dataMode: simulated ? "SIMULATED" : projectMode === "DEMO" ? "DEMO" : ARC.dataMode,
  });
  const { tx, duplicate } = await createTransaction(db, {
    projectId: p.projectId,
    decisionId: decision.id,
    missionId: mission.id,
    kind: "x402_purchase",
    rail: "gateway_x402",
    budgetCategory: verdict.category,
    amountMicro: priceMicro,
    chain: ARC.appKitChain,
    recipient: liveQuote?.kind === "quote" ? liveQuote.quote.payTo : pick.svc.payTo,
    idempotencyKey,
    dataMode: simulated ? "SIMULATED" : ARC.dataMode,
  });
  if (duplicate) {
    // Lost a race with a concurrent purchase: close this decision instead of leaving it open.
    await updateDecision(db, decision.id, { status: "duplicate", result: { duplicateOf: tx.decisionId } });
    await writeReceipt(db, decision.id);
    log("operator", "Same purchase already made this hour — idempotency key matched; not paying twice");
    return { decisionId: tx.decisionId, bought: false, state: tx.state, confidenceBefore: before, confidenceAfter: null, priceMicro, settlementId: tx.settlementId, message: "Duplicate purchase prevented" };
  }

  if (verdict.verdict === "DENY") {
    await transition(db, tx.id, "DENIED", {}, verdict.checks.filter((c) => !c.passed).map((c) => c.rule).join(", "));
    await writeReceipt(db, decision.id);
    return { decisionId: decision.id, bought: false, state: "DENIED", confidenceBefore: before, confidenceAfter: null, priceMicro, settlementId: null, message: "Policy denied the purchase" };
  }
  if (verdict.verdict === "APPROVAL_REQUIRED") {
    await transition(db, tx.id, "AWAITING_APPROVAL");
    const approvalId = newId();
    await db.insert(s.approvals).values({ id: approvalId, projectId: p.projectId, decisionId: decision.id, transactionId: tx.id, title: `Buy data on ${company.name}`, details: { service: pick.vendor.name, reasons, policy: verdict.checks.filter((c) => !c.passed) }, requestedMicro: priceMicro });
    await writeReceipt(db, decision.id);
    await notifyApproval(db, { projectId: p.projectId, approvalId, title: `Buy data on ${company.name}`, requestedMicro: priceMicro });
    return { decisionId: decision.id, bought: false, state: "AWAITING_APPROVAL", confidenceBefore: before, confidenceAfter: null, priceMicro, settlementId: null, message: "Purchase needs founder approval" };
  }

  await transition(db, tx.id, "AUTHORIZED", {}, "policy ALLOW");
  return executePurchase(db, { txId: tx.id, decisionId: decision.id, projectId: p.projectId, companyId: company.id, url: url.toString(), liveQuote, priceMicro, before, serviceId: pick.svc.id, purpose: `Verify customer intent: ${company.name}`, log });
}

/** Execute an AUTHORIZED purchase (also used after founder approval). */
export async function executePurchase(
  db: DB,
  a: { txId: string; decisionId: string; projectId: string; companyId: string; url: string; liveQuote: Awaited<ReturnType<typeof quote>> | null; priceMicro: number; before: number; serviceId: string; purpose: string; log?: Logger },
): Promise<PurchaseOutcome> {
  const log = a.log ?? (() => {});
  const locked = await transition(db, a.txId, "EXECUTING", {}, "execution lock acquired");
  if (!locked) return { decisionId: a.decisionId, bought: false, state: "LOCKED", confidenceBefore: a.before, confidenceAfter: null, priceMicro: a.priceMicro, settlementId: null, message: "Another worker is executing this payment" };

  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, a.companyId));
  let data: { dataMode?: string; signals?: EnrichmentSignal[] } | null = null;
  let settlementId: string | null = null;
  let finalState: "SUBMITTED" | "SIMULATED" | "FAILED" = "FAILED";
  let payer: string | null = null;
  let httpStatus: number | null = null;
  let failure: string | null = null;

  const wallet = await getWallet(db, a.projectId);
  const signer = walletIsLive(wallet) && !wallet!.frozen ? signerFor(wallet) : null;
  const noSigner = !wallet ? "No agent wallet configured" : wallet.frozen ? "Wallet frozen (kill switch on)" : "Wallet cannot sign on this deployment";
  if (signer && a.liveQuote?.kind === "quote") {
    try {
      log("operator", `Signing x402 authorization for ${fmtUsdc(a.priceMicro)} (EIP-712, ${signer.kind === "circle_dcw" ? "Circle wallet" : "server development key"})`);
      const res = await pay(a.liveQuote.quote, signer, { maxAmountMicro: a.priceMicro });
      data = res.data as typeof data;
      settlementId = res.settlementId;
      payer = res.payer;
      httpStatus = res.status;
      finalState = "SUBMITTED";
      log("operator", `Circle Gateway accepted payment — settlement ${settlementId}`);
    } catch (e) {
      failure = (e as Error).message;
      log("operator", `x402 payment failed: ${failure}`);
    }
  } else {
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, a.projectId));
    if (project?.dataMode === "DEMO") {
      // No wallet (or seller unreachable) in a DEMO project: run the rest of the loop on the
      // seller's demo fixture and record the payment as SIMULATED — no id, no hash, no funds.
      data = demoCompanyIntel(company.name) ?? { dataMode: "DEMO", signals: [] };
      finalState = "SIMULATED";
      failure = signer ? `Seller unreachable: ${a.liveQuote?.kind === "unsupported" ? a.liveQuote.reason : a.liveQuote?.kind === "free" ? "endpoint did not require payment" : "no quote"}` : noSigner;
      log("operator", `SIMULATED payment (${failure}). Nothing moved on-chain.`);
    } else failure = signer ? "No payable quote from seller" : noSigner;
  }

  const digest = data ? sha256(canonicalJson(data)) : null;
  await db.insert(s.x402Purchases).values({ id: newId(), transactionId: a.txId, serviceId: a.serviceId, resourceUrl: a.url, method: "GET", priceMicro: a.priceMicro, purpose: a.purpose, payer, network: ARC.caip2, httpStatus, responseDigest: digest, responseExcerpt: data ? (data as Record<string, unknown>) : null });
  await transition(db, a.txId, finalState, { settlementId, settlementStatus: settlementId ? "received" : null, error: failure }, failure ?? undefined);

  // Consume what we bought: each signal becomes attributable evidence.
  let added = 0;
  if (data?.signals?.length) {
    const [purchase] = await db.select().from(s.x402Purchases).where(eq(s.x402Purchases.transactionId, a.txId));
    const mode = data.dataMode === "DEMO" ? "DEMO" : "LIVE";
    for (const sig of data.signals) {
      const r = await db
        .insert(s.evidence)
        .values({
          id: newId(),
          projectId: a.projectId,
          companyId: a.companyId,
          purchaseId: purchase.id,
          dedupeKey: `x402:${a.companyId}:${sha256(sig.sourceUrl + sig.summary).slice(0, 16)}`,
          sourceUrl: sig.sourceUrl,
          sourceTitle: `Purchased via x402 — ${sig.summary.slice(0, 60)}`,
          provider: "x402",
          excerpt: sig.summary,
          signalType: sig.signalType,
          observedAt: new Date(sig.observedAt),
          weight: sig.confidence,
          classifiedBy: "x402",
          dataMode: mode,
        })
        .onConflictDoNothing()
        .returning({ id: s.evidence.id });
      added += r.length;
    }
  }
  // Re-score with the new evidence (deterministic — the purchase can only move confidence by adding evidence).
  await analyzeProject(db, a.projectId, () => {});
  const [after] = await db.select().from(s.companies).where(eq(s.companies.id, a.companyId));
  const confidenceAfter = after?.confidence ?? null;
  await updateDecision(db, a.decisionId, {
    status: finalState === "FAILED" ? "failed" : "executed",
    result: { confidenceAfter, signalsAdded: added, settlementId, state: finalState, summary: `${added} additional intent signal(s) found` },
    dataMode: mergeMode([finalState === "SIMULATED" ? "SIMULATED" : ARC.dataMode, ...(data?.dataMode === "DEMO" ? (["DEMO"] as const) : [])]),
  });
  await writeReceipt(db, a.decisionId);
  log("operator", `${company.name}: ${added} new signal(s); confidence ${(a.before * 100).toFixed(0)}% → ${confidenceAfter != null ? (confidenceAfter * 100).toFixed(0) : "?"}%`);
  return { decisionId: a.decisionId, bought: finalState !== "FAILED", state: finalState, confidenceBefore: a.before, confidenceAfter, priceMicro: a.priceMicro, settlementId, message: failure ?? "Purchased" };
}

/** Latest purchases for the activity feed. */
export async function recentPurchases(db: DB, projectId: string, limit = 20) {
  return db
    .select({ p: s.x402Purchases, tx: s.transactions })
    .from(s.x402Purchases)
    .innerJoin(s.transactions, eq(s.x402Purchases.transactionId, s.transactions.id))
    .where(eq(s.transactions.projectId, projectId))
    .orderBy(desc(s.x402Purchases.createdAt))
    .limit(limit);
}

export { demoCreatorAudience };
