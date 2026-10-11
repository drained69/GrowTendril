import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { experimentSpend } from "@/server/domain/agent/ledger";
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
  e: { projectId: string; eventType: ConversionEventType; referralCode?: string | null; visitorId?: string | null; idempotencyKey: string; occurredAt?: Date; source: "redirect" | "webhook" | "demo"; valueMicro?: number; customName?: string | null; metadata?: Record<string, unknown>; dataMode: Mode },
): Promise<{ id: string; attributed: boolean; duplicate: boolean }> {
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
    const [dup] = await db.select({ id: s.conversionEvents.id, campaignId: s.conversionEvents.campaignId }).from(s.conversionEvents).where(eq(s.conversionEvents.idempotencyKey, e.idempotencyKey));
    return { id: dup.id, attributed: !!dup.campaignId, duplicate: true };
  }
  if (campaign) await db.insert(s.attribution).values({ id: newId(), conversionEventId: row.id, campaignId: campaign.id, experimentId: campaign.experimentId, model: "referral_code", weight: 1 }).onConflictDoNothing();
  return { id: row.id, attributed: !!campaign, duplicate: false };
}

/** Measured performance per experiment: committed spend (ledger SPENT_STATES) and attributed conversions (events). */
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
    out.push({
      experimentId: x.id,
      number: x.number,
      title: x.title,
      channel: x.channel,
      status: x.status,
      budgetMicro: x.budgetMicro,
      spentMicro: await experimentSpend(db, x.id),
      conversions: count(x.id, mission?.goalEvent ?? x.successEvent),
      visits: count(x.id, "visit"),
      successTarget: x.successTarget,
      stopMaxCpaMicro: x.stopMaxCpaMicro,
      stopAfterSpendMicro: x.stopAfterSpendMicro,
    });
  }
  return out;
}

/** Mission progress = distinct visitors who completed the goal event, attributed or not. */
export async function missionProgress(db: DB, mission: typeof s.missions.$inferSelect): Promise<{ achieved: number; attributed: number }> {
  const [all] = await db
    .select({ n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
    .from(s.conversionEvents)
    .where(and(eq(s.conversionEvents.projectId, mission.projectId), eq(s.conversionEvents.eventType, mission.goalEvent), sql`${s.conversionEvents.occurredAt} >= ${mission.startsAt}`));
  const [attr] = await db
    .select({ n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
    .from(s.conversionEvents)
    .innerJoin(s.attribution, eq(s.attribution.conversionEventId, s.conversionEvents.id))
    .innerJoin(s.experiments, eq(s.attribution.experimentId, s.experiments.id))
    .where(and(eq(s.experiments.missionId, mission.id), eq(s.conversionEvents.eventType, mission.goalEvent)));
  return { achieved: all?.n ?? 0, attributed: attr?.n ?? 0 };
}
