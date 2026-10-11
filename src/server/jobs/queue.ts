import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";

export type JobKind = "cycle" | "scan" | "settlements" | "gateway_deposit" | "cleanup" | "webhook";
export type Job = typeof s.jobs.$inferSelect;

/** Enqueue a job. With a dedupeKey, a second enqueue of the same logical job is a no-op. */
export async function enqueue(
  db: DB,
  j: { kind: JobKind; projectId?: string | null; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; trigger?: "system" | "user" | "schedule"; maxAttempts?: number },
): Promise<Job | null> {
  const [row] = await db
    .insert(s.jobs)
    .values({ id: newId(), kind: j.kind, projectId: j.projectId ?? null, payload: j.payload ?? {}, runAt: j.runAt ?? new Date(), dedupeKey: j.dedupeKey ?? null, trigger: j.trigger ?? "system", maxAttempts: j.maxAttempts ?? 3 })
    .onConflictDoNothing({ target: s.jobs.dedupeKey })
    .returning();
  return row ?? null;
}

const LEASE_MS = 15 * 60_000;

/**
 * Claim the next due job atomically (FOR UPDATE SKIP LOCKED), so several workers can share
 * one Postgres without double-running a job. Expired leases are recovered first.
 */
export async function claimNext(db: DB, workerId: string): Promise<Job | null> {
  await db
    .update(s.jobs)
    .set({ status: "queued", lockedBy: null, lockedUntil: null, lastError: sql`coalesce(${s.jobs.lastError}, 'lease expired')` })
    .where(and(eq(s.jobs.status, "running"), lt(s.jobs.lockedUntil, new Date())));
  const res = await db.execute(sql`
    UPDATE ${s.jobs} SET status = 'running', locked_by = ${workerId}, locked_until = ${new Date(Date.now() + LEASE_MS)},
      attempts = attempts + 1, started_at = now()
    WHERE id = (
      SELECT id FROM ${s.jobs} WHERE status = 'queued' AND run_at <= now()
      ORDER BY run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = (res as unknown as { rows: { id: string }[] }).rows?.[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(s.jobs).where(eq(s.jobs.id, id));
  return job ?? null;
}

export async function completeJob(db: DB, id: string, result: Record<string, unknown> = {}) {
  await db.update(s.jobs).set({ status: "done", result, finishedAt: new Date(), lockedBy: null, lockedUntil: null, lastError: null }).where(eq(s.jobs.id, id));
}

/** Failed attempts retry with exponential backoff (30s, 2m, 8m…) until maxAttempts. */
export async function failJob(db: DB, job: Job, error: string) {
  const final = job.attempts >= job.maxAttempts;
  await db
    .update(s.jobs)
    .set({
      status: final ? "failed" : "queued",
      lastError: error.slice(0, 1000),
      runAt: final ? job.runAt : new Date(Date.now() + 30_000 * 4 ** (job.attempts - 1)),
      finishedAt: final ? new Date() : null,
      lockedBy: null,
      lockedUntil: null,
    })
    .where(eq(s.jobs.id, job.id));
}

export async function recentJobs(db: DB, projectId: string, limit = 30) {
  return db.select().from(s.jobs).where(eq(s.jobs.projectId, projectId)).orderBy(desc(s.jobs.createdAt)).limit(limit);
}

export async function activeJob(db: DB, projectId: string, kind: JobKind) {
  const [j] = await db
    .select()
    .from(s.jobs)
    .where(and(eq(s.jobs.projectId, projectId), eq(s.jobs.kind, kind), sql`${s.jobs.status} in ('queued','running')`))
    .orderBy(desc(s.jobs.createdAt))
    .limit(1);
  return j ?? null;
}
