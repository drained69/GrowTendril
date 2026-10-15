import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { SendPaymentAction } from "@/server/domain/agent/actions";
import { toMicro } from "@/lib/money";
import { calculateReward } from "@arc-growth/outcomes";

/** Enforced at proposal and immediately before signing, including generic payment entry points. */
export async function assertCreatorReward(db: DB, projectId: string, action: SendPaymentAction, excludeTxId?: string) {
  const [program] = await db.select().from(s.creatorPrograms).where(eq(s.creatorPrograms.experimentId, action.experimentId));
  if (!program && !action.contributionId) return;
  if (!program || program.projectId !== projectId || !action.contributionId) throw new Error("Creator campaigns pay only reviewed contribution rewards");
  const [c] = await db.select({ post: s.creatorContributions, creator: s.creatorParticipants }).from(s.creatorContributions)
    .innerJoin(s.creatorParticipants, eq(s.creatorParticipants.id, s.creatorContributions.participantId))
    .where(and(eq(s.creatorContributions.id, action.contributionId), eq(s.creatorContributions.programId, program.id), eq(s.creatorParticipants.programId, program.id)));
  if (!c || c.post.status !== "accepted" || c.creator.status !== "verified" || !c.creator.acceptedAt || !c.creator.verifiedAt ||
    c.creator.payoutAddress?.toLowerCase() !== action.recipient.toLowerCase() || c.post.rewardMicro !== toMicro(action.amount) ||
    action.purpose !== "kol_payment" || action.reasonCode !== "PAY_CREATOR") throw new Error("The reward must match the accepted post, verified creator and published payout exactly");
  if (program.outcomeBonusMicro > 0) {
    const { qualifiedOutcomes } = await import("@/server/domain/growth/creator-campaigns");
    const outcomes = (await qualifiedOutcomes(db, program.id)).filter(o => o.participant === c.creator.id);
    if (calculateReward(program, c.post.score ?? 0, outcomes.length).totalMicro !== c.post.rewardMicro) throw new Error("Customer outcomes changed after review. Recalculate this reward before approving payment.");
  }
  const existing = await db.select({ id: s.transactions.id, state: s.transactions.state }).from(s.transactions)
    .innerJoin(s.agentDecisions, eq(s.agentDecisions.id, s.transactions.decisionId))
    .where(and(eq(s.transactions.projectId, projectId), sql`${s.agentDecisions.action}->>'contributionId' = ${action.contributionId}`));
  if (existing.some(t => t.id !== excludeTxId && !["FAILED", "DENIED", "REJECTED", "CANCELLED"].includes(t.state))) throw new Error("This creator reward is already paid or awaiting payment");
}
