import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";

process.env.PGLITE_DIR = "memory://";
const ADDRESS = "0x2222222222222222222222222222222222222222";
let db: DB;
let s: typeof import("@/server/db/schema");
let activateWorkspace: typeof import("@/server/domain/workspace/setup")["activateWorkspace"];

beforeAll(async () => {
  const client = await import("@/server/db/client");
  db = await client.getDb();
  s = client.schema;
  ({ activateWorkspace } = await import("@/server/domain/workspace/setup"));
  await db.insert(s.users).values({ id: "owner", email: "owner@example.test", name: "Owner", passwordHash: "x", emailVerifiedAt: new Date() });
  await db.insert(s.projects).values([
    { id: "paid", ownerId: "owner", name: "Paid", webhookSecret: "x" },
    { id: "free", ownerId: "owner", name: "Free", webhookSecret: "x" },
  ]);
});

describe("new workspace scan scheduling", () => {
  it("does not queue a paid scan during activation, even when Autopilot is selected", async () => {
    process.env.BILLING_ARC_ADDRESS = ADDRESS;
    try {
      await activateWorkspace(db, { projectId: "paid", rules: { dailySpend: "10", hardCeiling: "10", autonomousLimit: "0" }, autopilot: "daily" });
      expect(await db.select().from(s.jobs).where(eq(s.jobs.projectId, "paid"))).toHaveLength(0);
    } finally { delete process.env.BILLING_ARC_ADDRESS; }
  });

  it("still queues the free first scan when billing is disabled", async () => {
    await activateWorkspace(db, { projectId: "free", rules: { dailySpend: "10", hardCeiling: "10", autonomousLimit: "0" }, autopilot: "off" });
    const jobs = await db.select().from(s.jobs).where(eq(s.jobs.projectId, "free"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "cycle", trigger: "user" });
  });
});
