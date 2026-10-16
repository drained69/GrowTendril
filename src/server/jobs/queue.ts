import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { newId } from "@/server/lib/ids";
import { refundCharge } from "@/server/domain/billing";

export type JobKind = "cycle" | "settlements" | "gateway_deposit" | "cleanup" | "billing_check" | "billing_renewals" | "billing_reconcile" | "wallet_reconcile" | "webhook";
export type Job = typeof s.jobs.$inferSelect;

/** Enqueue a job. With a dedupeKey, a second enqueue of the same logical job is a no-op. */
export async function enqueue(
  db: DB,
  j: { kind: JobKind; projectId?: string | null; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; trigger?: "system" | "user" | "schedule"; maxAttempts?: number },
): Promise<Job | null> {
  if (j.kind === "cycle" && j.projectId) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cycle-queue:${j.projectId}`}))`);
      const existing = await activeJob(tx as unknown as DB, j.projectId!, "cycle");
      if (existing) return existing;
      return insertJob(tx as unknown as DB, j);
    });
  }
  return insertJob(db, j);
}

async function insertJob(db: DB, j: Parameters<typeof enqueue>[1]): Promise<Job | null> {
  const [row] = await db
    .insert(s.jobs)
    .values({ id: newId(), kind: j.kind, projectId: j.projectId ?? null, payload: j.payload ?? {}, runAt: j.runAt ?? new Date(), dedupeKey: j.dedupeKey ?? null, trigger: j.trigger ?? "system", maxAttempts: j.maxAttempts ?? 3 })
    .onConflictDoNothing({ target: s.jobs.dedupeKey })
    .returning();
  return row ?? null;
}

// Short lease, renewed while the job runs: a crashed or redeployed worker frees its job within minutes.
export const LEASE_MS = 2 * 60_000;

export async function renewLease(db: DB, id: string, workerId: string, attempts: number) {
  await db
    .update(s.jobs)
    .set({ lockedUntil: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(s.jobs.id, id), eq(s.jobs.status, "running"), eq(s.jobs.lockedBy, workerId), eq(s.jobs.attempts, attempts), gt(s.jobs.lockedUntil, new Date())));
}

/**
 * Claim the next due job atomically (FOR UPDATE SKIP LOCKED), so several workers can share
 * one Postgres without double-running a job. Expired leases are recovered first.
 */
export async function claimNext(db: DB, workerId: string): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const tdb = tx as unknown as DB;
    const expired = await tx
      .update(s.jobs)
      .set({ status: sql`case when ${s.jobs.attempts} >= ${s.jobs.maxAttempts} then 'failed' else 'queued' end`, finishedAt: sql`case when ${s.jobs.attempts} >= ${s.jobs.maxAttempts} then now() else null end`, lockedBy: null, lockedUntil: null, lastError: "Worker lease expired; inspect interrupted operations before retrying" })
      .where(and(eq(s.jobs.status, "running"), or(lt(s.jobs.lockedUntil, new Date()), isNull(s.jobs.lockedUntil))))
      .returning({ id: s.jobs.id, kind: s.jobs.kind, attempts: s.jobs.attempts });
    // A process can die after charging but before the handler's catch block runs. Keep the
    // recovery and refund atomic, including when the expired attempt was the final one.
    for (const job of expired) if (job.kind === "cycle") await refundCharge(tdb, `job:${job.id}:${job.attempts}`, "Interrupted scan attempt — refunded");
    const res = await tx.execute(sql`
    UPDATE ${s.jobs} SET status = 'running', locked_by = ${workerId}, locked_until = ${new Date(Date.now() + LEASE_MS)},
      attempts = attempts + 1, started_at = now()
    WHERE id = (
      SELECT id FROM ${s.jobs} WHERE status = 'queued' AND run_at <= now() AND attempts < max_attempts
      ORDER BY run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
    const id = (res as unknown as { rows: { id: string }[] }).rows?.[0]?.id;
    if (!id) return null;
    const [job] = await tx.select().from(s.jobs).where(eq(s.jobs.id, id));
    return job ?? null;
  });
}

export async function completeJob(db: DB, job: Job, result: Record<string, unknown> = {}) {
  if (!job.lockedBy) return false;
  const rows = await db.update(s.jobs).set({ status: "done", result, finishedAt: new Date(), lockedBy: null, lockedUntil: null, lastError: null }).where(and(eq(s.jobs.id, job.id), eq(s.jobs.status, "running"), eq(s.jobs.lockedBy, job.lockedBy), eq(s.jobs.attempts, job.attempts), gt(s.jobs.lockedUntil, new Date()))).returning({ id: s.jobs.id });
  return rows.length > 0;
}

/** Failed attempts retry with exponential backoff (30s, 2m, 8m…) until maxAttempts. */
export async function failJob(db: DB, job: Job, error: string) {
  const lockedBy = job.lockedBy;
  if (!lockedBy) return false;
  const final = job.attempts >= job.maxAttempts;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(s.jobs)
      .set({
        status: final ? "failed" : "queued",
        lastError: error.slice(0, 1000),
        runAt: final ? job.runAt : new Date(Date.now() + 30_000 * 4 ** (job.attempts - 1)),
        finishedAt: final ? new Date() : null,
        lockedBy: null,
        lockedUntil: null,
      })
      .where(and(eq(s.jobs.id, job.id), eq(s.jobs.status, "running"), eq(s.jobs.lockedBy, lockedBy), eq(s.jobs.attempts, job.attempts), gt(s.jobs.lockedUntil, new Date())))
      .returning({ id: s.jobs.id });
    if (rows.length && job.kind === "cycle") await refundCharge(tx as unknown as DB, `job:${job.id}:${job.attempts}`, "Failed scan attempt — refunded");
    return rows.length > 0;
  });
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
