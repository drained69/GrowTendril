import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { PENDING_STATES, SPENT_STATES } from "@/server/domain/agent/ledger";
import type { ExperimentPerformance } from "@/server/domain/growth/learning";
import type { ConversionEventType } from "@/server/domain/growth/attribution-links";

type Mode = (typeof s.dataMode.enumValues)[number];

/**
 * Deterministic first-party attribution: a conversion is attributed to a campaign only when it
 * carries that campaign's referral code (from the /r/<code> link, a UTM-tagged landing, or the
 * product's own webhook). No modelled or LLM-guessed attribution.
 */
export async function recordConversion(
  db: DB,
  e: { projectId: string; eventType: ConversionEventType; referralCode?: string | null; visitorId?: string | null; idempotencyKey: string; occurredAt?: Date; source: "redirect" | "webhook" | "manual" | "demo"; valueMicro?: number; customName?: string | null; metadata?: Record<string, unknown>; dataMode: Mode },
): Promise<{ id: string; attributed: boolean; duplicate: boolean }> {
  if (!Number.isSafeInteger(e.valueMicro ?? 0) || (e.valueMicro ?? 0) < 0) throw new Error("Conversion value must be a nonnegative, safe integer amount of micro-USDC");
  if (e.eventType === "refund" && (!e.visitorId?.trim() || typeof e.metadata?.orderId !== "string" || !e.metadata.orderId.trim() || !(e.valueMicro! > 0))) throw new Error("Refunds require a customer ID, metadata.orderId and positive value");
  return db.transaction(async (tx) => {
  const db = tx as unknown as DB;
  const campaign = e.referralCode ? (await db.select().from(s.campaigns).where(eq(s.campaigns.referralCode, e.referralCode)))[0] : undefined;
  if (campaign) {
    // Guard against a code from another project being replayed here.
    const [exp] = await db.select({ projectId: s.experiments.projectId }).from(s.experiments).where(eq(s.experiments.id, campaign.experimentId));
    if (exp?.projectId !== e.projectId) throw new Error("referral code does not belong to this project");
  }
  const [row] = await db
    .insert(s.conversionEvents)
    .values({
      id: newId(),
      projectId: e.projectId,
      campaignId: campaign?.id ?? null,
      eventType: e.eventType,
      customName: e.customName ?? null,
      visitorId: e.visitorId ?? null,
      referralCode: e.referralCode ?? null,
      valueMicro: e.valueMicro ?? 0,
      source: e.source,
      idempotencyKey: e.idempotencyKey,
      metadata: e.metadata ?? {},
      occurredAt: e.occurredAt ?? new Date(),
      dataMode: e.dataMode,
    })
    .onConflictDoNothing({ target: s.conversionEvents.idempotencyKey })
    .returning({ id: s.conversionEvents.id });
  if (!row) {
    const [dup] = await db.select({ id: s.conversionEvents.id, campaignId: s.conversionEvents.campaignId }).from(s.conversionEvents).where(and(eq(s.conversionEvents.idempotencyKey, e.idempotencyKey), eq(s.conversionEvents.projectId, e.projectId)));
    if (!dup) throw new Error("Conversion idempotency key belongs to another workspace");
    return { id: dup.id, attributed: !!dup.campaignId, duplicate: true };
  }
  if (campaign) await db.insert(s.attribution).values({ id: newId(), conversionEventId: row.id, campaignId: campaign.id, experimentId: campaign.experimentId, model: "referral_code", weight: 1 }).onConflictDoNothing();
  return { id: row.id, attributed: !!campaign, duplicate: false };
  });
}

/** Measured performance per experiment: settled spend (ledger) and attributed conversions (events). */
export async function missionPerformance(db: DB, missionId: string): Promise<ExperimentPerformance[]> {
  const [mission] = await db.select().from(s.missions).where(eq(s.missions.id, missionId));
  const exps = await db.select().from(s.experiments).where(eq(s.experiments.missionId, missionId));
  if (!exps.length) return [];
  const counts = await db
    .select({ experimentId: s.attribution.experimentId, eventType: s.conversionEvents.eventType, n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
    .from(s.attribution)
    .innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id))
    .where(inArray(s.attribution.experimentId, exps.map((x) => x.id)))
    .groupBy(s.attribution.experimentId, s.conversionEvents.eventType);
  const count = (id: string, type: string) => counts.find((c) => c.experimentId === id && c.eventType === type)?.n ?? 0;
  const out: ExperimentPerformance[] = [];
  for (const x of exps) {
    const [spend] = await db.select({ settled: sql<string>`coalesce(sum(case when ${s.transactions.state} = 'SETTLED' then ${s.transactions.amountMicro} else 0 end), 0)`, committed: sql<string>`coalesce(sum(${s.transactions.amountMicro}), 0)` }).from(s.transactions).where(and(eq(s.transactions.experimentId, x.id), inArray(s.transactions.state, [...SPENT_STATES, ...PENDING_STATES, "PROPOSED"])));
    out.push({
      experimentId: x.id,
      number: x.number,
      title: x.title,
      channel: x.channel,
      status: x.status,
      budgetMicro: x.budgetMicro,
      spentMicro: Number(spend.settled),
      committedMicro: Number(spend.committed),
      conversions: count(x.id, x.successEvent),
      visits: count(x.id, "visit"),
      successTarget: x.successTarget,
      stopMaxCpaMicro: x.stopMaxCpaMicro,
      stopAfterSpendMicro: x.stopAfterSpendMicro,
      startsAt: x.startsAt,
      endsAt: x.endsAt,
      timeframeDays: x.timeframeDays,
    });
  }
  return out;
}

/** Mission progress = distinct visitors who completed the goal event, attributed or not. */
export async function missionProgress(db: DB, mission: typeof s.missions.$inferSelect): Promise<{ achieved: number; attributed: number }> {
  const [all] = await db
    .select({ n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
    .from(s.conversionEvents)
    .where(and(eq(s.conversionEvents.projectId, mission.projectId), eq(s.conversionEvents.eventType, mission.goalEvent), sql`${s.conversionEvents.occurredAt} >= ${mission.startsAt}`, sql`${s.conversionEvents.occurredAt} <= ${mission.endsAt}`));
  const [attr] = await db
    .select({ n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
    .from(s.conversionEvents)
    .innerJoin(s.attribution, eq(s.attribution.conversionEventId, s.conversionEvents.id))
    .innerJoin(s.experiments, eq(s.attribution.experimentId, s.experiments.id))
    .where(and(eq(s.experiments.missionId, mission.id), eq(s.conversionEvents.projectId, mission.projectId), eq(s.conversionEvents.eventType, mission.goalEvent), sql`${s.conversionEvents.occurredAt} >= ${mission.startsAt}`, sql`${s.conversionEvents.occurredAt} <= ${mission.endsAt}`));
  return { achieved: all?.n ?? 0, attributed: attr?.n ?? 0 };
}
