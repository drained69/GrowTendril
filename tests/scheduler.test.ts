import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";

let db: DB;
let s: typeof import("@/server/db/schema");
let scheduler: typeof import("@/server/jobs/scheduler");
let q: typeof import("@/server/jobs/queue");

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  scheduler = await import("@/server/jobs/scheduler");
  q = await import("@/server/jobs/queue");
});

describe("autopilot scheduling", () => {
  it("does not queue a second cycle while the first scan is still pending", async () => {
    await db.insert(s.users).values({ id: "u1", email: "owner@example.test", name: "Owner", passwordHash: "x" });
    await db.insert(s.projects).values({ id: "p1", ownerId: "u1", name: "Crumb Club", webhookSecret: "secret", autopilot: "every_6h" });
    await q.enqueue(db, { kind: "cycle", projectId: "p1", trigger: "user", dedupeKey: "first-scan:p1" });
    await scheduler.tick(db);
    const cycles = await db.select().from(s.jobs).where(and(eq(s.jobs.projectId, "p1"), eq(s.jobs.kind, "cycle")));
    expect(cycles).toHaveLength(1);

    // Once it finishes, the next autopilot cycle is scheduled as normal.
    await db.update(s.jobs).set({ status: "done" }).where(eq(s.jobs.id, cycles[0].id));
    await scheduler.tick(db);
    const after = await db.select().from(s.jobs).where(and(eq(s.jobs.projectId, "p1"), eq(s.jobs.kind, "cycle")));
    expect(after).toHaveLength(2);
  });
});
