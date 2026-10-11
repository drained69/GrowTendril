import { and, eq, gt, inArray, ne } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { billingMode, canAfford } from "@/server/domain/billing";
import { walletsToReconcile } from "@/server/domain/reconcile/wallet";

export const AUTOPILOT_INTERVAL_MS: Record<string, number> = { hourly: 3_600_000, every_6h: 6 * 3_600_000, daily: 24 * 3_600_000 };
export const AUTOPILOT_LABEL: Record<string, string> = { off: "Off", hourly: "Every hour", every_6h: "Every 6 hours", daily: "Daily" };

/**
 * Turns schedules into jobs. Dedupe keys are time-bucketed, so calling tick() from several
 * workers (or every few seconds) never creates duplicate work.
 */
export async function tick(db: DB, now = Date.now()) {
  // Autopilot: one operator cycle per workspace per interval.
  const due = await db.select({ id: s.projects.id, ownerId: s.projects.ownerId, autopilot: s.projects.autopilot, last: s.projects.lastCycleAt }).from(s.projects).where(and(ne(s.projects.autopilot, "off"), eq(s.projects.dataMode, "LIVE")));
  // A cycle already waiting or running (e.g. the first scan after activation) covers this interval.
  const busy = new Set(
    (await db.select({ pid: s.jobs.projectId }).from(s.jobs).where(and(eq(s.jobs.kind, "cycle"), inArray(s.jobs.status, ["queued", "running"])))).map((j) => j.pid),
  );
  for (const p of due) {
    const every = AUTOPILOT_INTERVAL_MS[p.autopilot];
    if (!every || busy.has(p.id) || (p.last && now - p.last.getTime() < every)) continue;
    // Each autopilot run is a paid scan; it waits until the owner's balance covers it.
    if (!(await canAfford(db, p.ownerId, "scan"))) continue;
    await enqueue(db, { kind: "cycle", projectId: p.id, trigger: "schedule", dedupeKey: `cycle:${p.id}:${Math.floor(now / every)}` });
  }
  // Settlements: poll workspaces with payments in flight every 2 minutes.
  const inflight = await db.selectDistinct({ pid: s.transactions.projectId }).from(s.transactions).where(eq(s.transactions.state, "SUBMITTED"));
  for (const r of inflight) await enqueue(db, { kind: "settlements", projectId: r.pid, dedupeKey: `settle:${r.pid}:${Math.floor(now / 120_000)}`, maxAttempts: 1 });
  // Billing on Arc: watch open top-up invoices every minute; expire stale ones hourly.
  if (billingMode() === "arc") {
    const [open] = await db.select({ id: s.billingInvoices.id }).from(s.billingInvoices).where(and(eq(s.billingInvoices.status, "pending"), gt(s.billingInvoices.expiresAt, new Date(now - 10 * 60_000)))).limit(1);
    if (open) await enqueue(db, { kind: "billing_check", dedupeKey: `billing-check:${Math.floor(now / 60_000)}`, maxAttempts: 1 });
    await enqueue(db, { kind: "billing_renewals", dedupeKey: `billing-renewals:${Math.floor(now / 3_600_000)}`, maxAttempts: 2 });
    // Every transfer into the billing address must belong to an invoice.
    await enqueue(db, { kind: "billing_reconcile", dedupeKey: `billing-reconcile:${Math.floor(now / 600_000)}`, maxAttempts: 1 });
  }
  // Every transfer out of an agent wallet must belong to a recorded payment.
  for (const pid of await walletsToReconcile(db)) await enqueue(db, { kind: "wallet_reconcile", projectId: pid, dedupeKey: `wallet-reconcile:${pid}:${Math.floor(now / 1_800_000)}`, maxAttempts: 1 });
  // Housekeeping once a day.
  await enqueue(db, { kind: "cleanup", dedupeKey: `cleanup:${Math.floor(now / 86_400_000)}`, maxAttempts: 1 });
}
