import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { nextNumber, audit } from "@/server/db/helpers";
import { canonicalJson, newId, sha256 } from "@/server/lib/ids";
import { CHAINS } from "@/server/integrations/circle/config";
import type { PolicyResult } from "@/server/domain/agent/policy";

type Mode = (typeof s.dataMode.enumValues)[number];
export type Decision = typeof s.agentDecisions.$inferSelect;

export async function recordDecision(
  db: DB,
  d: {
    projectId: string;
    missionId?: string | null;
    runId?: string | null;
    agent: string;
    kind: string;
    action: Record<string, unknown>;
    rationale: string;
    inputs?: Record<string, unknown>;
    policy?: PolicyResult | null;
    status: string;
    autonomous?: boolean;
    result?: Record<string, unknown>;
    dataMode: Mode;
  },
): Promise<Decision> {
  const number = await nextNumber(db, "agent_decisions", d.projectId);
  const [row] = await db
    .insert(s.agentDecisions)
    .values({
      id: newId(),
      projectId: d.projectId,
      missionId: d.missionId ?? null,
      runId: d.runId ?? null,
      number,
      agent: d.agent,
      kind: d.kind,
      action: d.action,
      rationale: d.rationale,
      inputs: d.inputs ?? {},
      policyVerdict: d.policy?.verdict ?? null,
      policyChecks: d.policy?.checks.map((c) => ({ rule: c.rule, passed: c.passed, detail: c.detail })) ?? [],
      status: d.status,
      autonomous: d.autonomous ?? true,
      result: d.result ?? null,
      dataMode: d.dataMode,
    })
    .returning();
  await audit(db, { projectId: d.projectId, actorType: "agent", actorId: d.agent, action: `decision.${d.kind}`, target: row.id, data: { number, status: d.status, verdict: d.policy?.verdict } });
  return row;
}

export async function updateDecision(db: DB, id: string, patch: Partial<typeof s.agentDecisions.$inferInsert>) {
  await db.update(s.agentDecisions).set({ ...patch, updatedAt: new Date() }).where(eq(s.agentDecisions.id, id));
}

const TERMINAL = new Set(["SETTLED", "EXCEPTION", "SIMULATED", "FAILED", "DENIED", "REJECTED"]);

/**
 * (Re)build the receipt for a decision from the ledger. The body is canonical JSON and its
 * sha256 is stored, so any later edit to the stored body is detectable.
 */
export async function writeReceipt(db: DB, decisionId: string) {
  const [d] = await db.select().from(s.agentDecisions).where(eq(s.agentDecisions.id, decisionId));
  if (!d) return;
  const [tx] = await db.select().from(s.transactions).where(eq(s.transactions.decisionId, d.id));
  const purchase = tx ? (await db.select().from(s.x402Purchases).where(eq(s.x402Purchases.transactionId, tx.id)))[0] : undefined;
  const service = purchase?.serviceId ? (await db.select({ svc: s.services, vendor: s.vendors }).from(s.services).innerJoin(s.vendors, eq(s.services.vendorId, s.vendors.id)).where(eq(s.services.id, purchase.serviceId)))[0] : undefined;
  const [approval] = await db.select().from(s.approvals).where(eq(s.approvals.decisionId, d.id));
  const events = tx ? await db.select().from(s.transactionEvents).where(eq(s.transactionEvents.transactionId, tx.id)) : [];

  const inputs = d.inputs as { confidenceBefore?: number; reasons?: string[] };
  const result = (d.result ?? {}) as { confidenceAfter?: number; summary?: string };
  const body = {
    decision: d.number,
    agent: d.agent,
    action: d.kind,
    structuredAction: d.action,
    service: service ? { vendor: service.vendor.name, source: service.vendor.source, resource: service.svc.resourceUrl } : null,
    costMicro: tx?.amountMicro ?? null,
    why: { rationale: d.rationale, reasons: inputs.reasons ?? [] },
    policy: d.policyVerdict ? { verdict: d.policyVerdict, checks: d.policyChecks } : null,
    approval: approval ? { status: approval.status, resolvedAt: approval.resolvedAt?.toISOString() ?? null, approvedMicro: approval.approvedMicro, note: approval.note } : null,
    status: tx?.state ?? d.status,
    autonomous: d.autonomous,
    result: d.result,
    confidence: inputs.confidenceBefore != null ? { before: inputs.confidenceBefore, after: result.confidenceAfter ?? null } : null,
    payment: tx
      ? {
          rail: tx.rail,
          network: CHAINS[tx.chain]?.label ?? tx.chain,
          destination: tx.destChain ? CHAINS[tx.destChain]?.label ?? tx.destChain : null,
          state: tx.state,
          chainCheck: tx.chainCheck,
          chainCheckedAt: tx.chainCheckedAt?.toISOString() ?? null,
          settlementId: tx.settlementId,
          settlementStatus: tx.settlementStatus,
          txHash: tx.txHash,
          batchTxHash: tx.batchTxHash,
          explorerUrl: tx.explorerUrl,
          responseDigest: purchase?.responseDigest ?? null,
          trail: events.map((e) => ({ from: e.fromState, to: e.toState, at: e.at.toISOString(), note: e.note })),
        }
      : null,
    dataMode: tx?.dataMode ?? d.dataMode,
    createdAt: d.createdAt.toISOString(),
  };
  const digest = sha256(canonicalJson(body));
  const finalizedAt = !tx || TERMINAL.has(tx.state) ? new Date() : null;
  await db
    .insert(s.decisionReceipts)
    .values({ id: newId(), decisionId: d.id, projectId: d.projectId, body, digest, finalizedAt })
    .onConflictDoUpdate({ target: s.decisionReceipts.decisionId, set: { body, digest, finalizedAt } });
}
