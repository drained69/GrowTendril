import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { AnalysisResult, IcpProposal } from "@/server/domain/intel/product-analyst";
import { DEFAULT_POLICY } from "@/server/domain/agent/policy";
import { missionTemplate } from "@/lib/missions";
import { enqueue } from "@/server/jobs/queue";
import { newId } from "@/server/lib/ids";
import { toMicro } from "@/lib/money";
import { DAY_MS } from "@/lib/time";

/**
 * Workspace setup steps shared by the step-by-step onboarding and the one-link quick start,
 * so both produce exactly the same records.
 */

export async function createWorkspace(
  db: DB,
  a: { userId: string; name: string; website?: string | null; docsUrl?: string | null; xHandle?: string | null; githubUrl?: string | null; description: string; onboardingStep: number; analysis: AnalysisResult },
): Promise<string> {
  return db.transaction(async (tx) => {
  const projectId = newId();
  await tx.insert(s.projects).values({
    id: projectId,
    ownerId: a.userId,
    name: a.name,
    website: a.website ?? null,
    docsUrl: a.docsUrl ?? null,
    xHandle: a.xHandle ?? null,
    githubUrl: a.githubUrl ?? null,
    description: a.description,
    webhookSecret: randomBytes(32).toString("hex"),
    onboardingStep: a.onboardingStep,
    dataMode: "LIVE",
  });
  await tx.insert(s.memberships).values({ id: newId(), projectId, userId: a.userId, role: "owner" });
  await tx.insert(s.productProfiles).values({ id: newId(), projectId, ...a.analysis.profile, crawledSources: a.analysis.crawled, generatedBy: a.analysis.generatedBy });
  return projectId;
  });
}

export async function replaceIcps(db: DB, projectId: string, icps: IcpProposal[]) {
  await db.transaction(async (tx) => {
    await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).for("update");
    await tx.delete(s.icps).where(eq(s.icps.projectId, projectId));
    if (icps.length) await tx.insert(s.icps).values(icps.map((i) => ({ id: newId(), projectId, tier: i.tier, title: i.title, description: i.description, companySize: i.companySize, segments: i.segments, signals: i.signals })));
  });
}

/** Default split of a mission budget across spend categories. */
export const BUDGET_SPLIT: Record<string, number> = { research: 0.04, services: 0.03, kol: 0.45, bounty: 0.1, content: 0.28, community: 0.1 };

/** Pauses any active mission and starts a new one from a template. */
export async function startMission(db: DB, a: { projectId: string; templateKey: string; goal: number; days: number; budget: string; dataMode?: "LIVE" | "TESTNET" | "SIMULATED" | "DEMO" }) {
  const t = missionTemplate(a.templateKey);
  if (!t) throw new Error("Unknown mission template");
  const budget = toMicro(a.budget);
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("Enter a valid non-negative mission budget");
  if (!Number.isInteger(a.goal) || a.goal < 1 || a.goal > 1_000_000 || !Number.isInteger(a.days) || a.days < 1 || a.days > 180) throw new Error("Choose a valid goal and a timeframe between 1 and 180 days");
  return db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${a.projectId}`}))`);
  await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, a.projectId)).for("update");
  const openCreatorPools = await tx.select({ id: s.experiments.id }).from(s.experiments).where(and(eq(s.experiments.projectId, a.projectId), eq(s.experiments.channel, "creator_program"), inArray(s.experiments.status, ["running", "proposed", "awaiting_approval"])));
  if (openCreatorPools.length) throw new Error("Close active creator campaigns and settle their rewards before replacing this mission");
  await tx.update(s.missions).set({ status: "paused" }).where(and(eq(s.missions.projectId, a.projectId), eq(s.missions.status, "active")));
  const missionId = newId();
  await tx.insert(s.missions).values({
    id: missionId,
    projectId: a.projectId,
    template: t.key,
    name: t.name,
    goalDescription: `${a.goal} ${t.goalDescription}`,
    goalEvent: t.goalEvent,
    goalTarget: a.goal,
    budgetMicro: budget,
    startsAt: new Date(),
    endsAt: new Date(Date.now() + a.days * DAY_MS),
    status: "active",
    dataMode: a.dataMode ?? "LIVE",
  });
  const categories = Object.entries(BUDGET_SPLIT);
  let allocated = 0;
  await tx.insert(s.missionBudgets).values(categories.map(([category, pct], index) => {
    const amount = index === categories.length - 1 ? budget - allocated : Math.floor(budget * pct);
    allocated += amount;
    return { id: newId(), missionId, category, allocatedMicro: amount };
  }));
  return { missionId, template: t };
  });
}

export interface SpendingRules {
  dailySpend: string;
  hardCeiling: string;
  /** Per-payment amount the agent may spend on its own for research, data and API services. 0 = always ask. */
  autonomousLimit: string;
}

export function policyValues(r: SpendingRules) {
  for (const value of [r.dailySpend, r.hardCeiling, r.autonomousLimit]) {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value) || !Number.isSafeInteger(toMicro(value))) throw new Error("Enter a non-negative USDC amount with at most 6 decimal places");
  }
  const ceiling = toMicro(r.hardCeiling);
  if (ceiling <= 0) throw new Error("Set a positive per-payment ceiling");
  const autonomous = Math.min(toMicro(r.autonomousLimit), ceiling);
  return {
    ...DEFAULT_POLICY,
    autonomyEnabled: autonomous > 0,
    maxTransactionMicro: autonomous,
    dailySpendMicro: toMicro(r.dailySpend),
    // Creator payments and bounties always go to the founder.
    kolApprovalThresholdMicro: 0,
    bountyApprovalThresholdMicro: 0,
    customPaymentCeilingEnabled: true,
    hardCeilingMicro: ceiling,
    autonomousCategories: autonomous > 0 ? ["research", "services"] : [],
    approvalCategories: autonomous > 0 ? ["kol", "bounty", "content", "community", "treasury"] : DEFAULT_POLICY.approvalCategories,
    // Autonomous purchases only from services listed in Circle's Agent Marketplace.
    approvedServiceHosts: autonomous > 0 ? ["*"] : [],
  };
}

/** Saves the spending rules, marks onboarding done and queues the first market scan. */
export async function activateWorkspace(db: DB, a: { projectId: string; rules: SpendingRules; autopilot: string }) {
  const values = policyValues(a.rules);
  if (values.hardCeilingMicro <= 0) throw new Error("Set a positive per-payment ceiling");
  if (!["off", "hourly", "every_6h", "daily"].includes(a.autopilot)) throw new Error("Choose a valid autopilot schedule");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${a.projectId}`}))`);
    await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, a.projectId)).for("update");
    await tx.insert(s.policies).values({ id: newId(), projectId: a.projectId, ...values }).onConflictDoUpdate({ target: s.policies.projectId, set: values });
    await tx.update(s.projects).set({ onboardingStep: 5, autopilot: a.autopilot }).where(eq(s.projects.id, a.projectId));
    await enqueue(tx as unknown as DB, { kind: "cycle", projectId: a.projectId, trigger: "user", dedupeKey: `first-scan:${a.projectId}` });
  });
}
