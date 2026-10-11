"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getDb, schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { sessionCookieOptions, PROJECT_COOKIE } from "@/server/auth/session";
import { currentUser } from "@/server/auth/current";
import { analyzeProduct, proposeIcp, ProductProfileSchema } from "@/server/domain/intel/product-analyst";
import { DEFAULT_POLICY } from "@/server/domain/agent/policy";
import { enqueue } from "@/server/jobs/queue";
import { kickWorker } from "@/server/jobs/worker";
import { newId } from "@/server/lib/ids";
import { toMicro } from "@/lib/money";
import { DAY_MS } from "@/lib/time";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

const ProductForm = z.object({
  name: z.string().trim().min(1, "Product name is required").max(80),
  website: z.string().url("Website must be a full URL (https://…)").max(300).optional(),
  docsUrl: z.string().url("Docs must be a full URL").max(300).optional(),
  xHandle: z.string().max(60).optional(),
  githubUrl: z.string().url("GitHub must be a full URL").max(300).optional(),
  description: z.string().trim().min(10, "Describe the product in at least 10 characters").max(2000),
});

/** Step 1: create the workspace (creator becomes owner) and draft its product profile. */
export async function onboardProductAction(_: unknown, form: FormData): Promise<ActionResult<{ note: string; generatedBy: string }>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, error: "You are signed out" };
    if (user.isGuest) return { ok: false, error: "Create an account to set up a real workspace" };
    await limited(`onboard:${user.id}`, 6, 0.05);
    const opt = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const f = ProductForm.parse({ name: form.get("name"), website: opt("website"), docsUrl: opt("docsUrl"), xHandle: opt("xHandle")?.replace(/^@/, ""), githubUrl: opt("githubUrl"), description: form.get("description") });
    const db = await getDb();
    const analysis = await analyzeProduct(f);
    const projectId = newId();
    await db.insert(s.projects).values({ id: projectId, ownerId: user.id, name: f.name, website: f.website ?? null, docsUrl: f.docsUrl ?? null, xHandle: f.xHandle ?? null, githubUrl: f.githubUrl ?? null, description: f.description, webhookSecret: randomBytes(32).toString("hex"), onboardingStep: 2, dataMode: "LIVE" });
    await db.insert(s.memberships).values({ id: newId(), projectId, userId: user.id, role: "owner" });
    await db.insert(s.productProfiles).values({ id: newId(), projectId, ...analysis.profile, crawledSources: analysis.crawled, generatedBy: analysis.generatedBy });
    (await cookies()).set(PROJECT_COOKIE, projectId, sessionCookieOptions);
    await audit(db, { projectId, actorType: "user", actorId: user.id, action: "workspace.create" });
    return { ok: true, data: { note: analysis.note, generatedBy: analysis.generatedBy } };
  } catch (e) {
    return fail(e);
  }
}

export async function onboardIcpAction(): Promise<ActionResult> {
  try {
    const { project, db } = await guard("manage_workspace");
    // Re-proposing would replace an active workspace's ICP wholesale; after setup it is edited in Settings.
    if (project.onboardingStep >= 5) return { ok: false, error: "This workspace is already set up — edit the ICP in Settings" };
    const [profile] = await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, project.id));
    const r = await proposeIcp(ProductProfileSchema.parse({ ...profile, pricing: profile.pricing }), project.name);
    await db.delete(s.icps).where(eq(s.icps.projectId, project.id));
    await db.insert(s.icps).values(r.icps.map((i) => ({ id: newId(), projectId: project.id, tier: i.tier, title: i.title, description: i.description, companySize: i.companySize, segments: i.segments, signals: i.signals })));
    await db.update(s.projects).set({ onboardingStep: Math.max(project.onboardingStep, 3) }).where(eq(s.projects.id, project.id));
    revalidatePath("/onboarding");
    return { ok: true, message: r.note };
  } catch (e) {
    return fail(e);
  }
}

const MISSION_TEMPLATES = {
  first_100_customers: { name: "First 100 Customers", goalEvent: "purchase", goalDescription: "paying customers" },
  first_100_users: { name: "First 100 Users", goalEvent: "signup", goalDescription: "signups from people who match your ideal customer" },
  qualified_leads: { name: "Qualified Leads", goalEvent: "lead", goalDescription: "qualified leads" },
  first_100_devs: { name: "First 100 Developers", goalEvent: "sdk_key_created", goalDescription: "verified SDK users" },
  find_buyers: { name: "Find 20 Buyers", goalEvent: "demo_request", goalDescription: "high-intent qualified companies requesting a demo" },
  own_narrative: { name: "Own the Narrative", goalEvent: "visit", goalDescription: "qualified visits from the target narrative" },
  kol_discovery: { name: "KOL Discovery", goalEvent: "signup", goalDescription: "signups from validated creator campaigns" },
} as const;

const MissionForm = z.object({
  template: z.enum(["first_100_customers", "first_100_users", "qualified_leads", "first_100_devs", "find_buyers", "own_narrative", "kol_discovery"]),
  goal: z.coerce.number().int().min(1).max(1_000_000),
  days: z.coerce.number().int().min(1).max(180),
  budget: z.string().regex(/^\d+(\.\d{1,6})?$/, "Budget must be a USDC amount"),
});

/** Step 3 (also "New mission" later): pauses the active mission and starts a new one. */
export async function onboardMissionAction(_: unknown, form: FormData): Promise<ActionResult<{ done: boolean }>> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = MissionForm.parse({ template: form.get("template"), goal: form.get("goal"), days: form.get("days"), budget: form.get("budget") });
    const t = MISSION_TEMPLATES[f.template];
    const budget = toMicro(f.budget);
    await db.update(s.missions).set({ status: "paused" }).where(and(eq(s.missions.projectId, project.id), eq(s.missions.status, "active")));
    const missionId = newId();
    await db.insert(s.missions).values({ id: missionId, projectId: project.id, template: f.template, name: t.name, goalDescription: `${f.goal} ${t.goalDescription}`, goalEvent: t.goalEvent, goalTarget: f.goal, budgetMicro: budget, startsAt: new Date(), endsAt: new Date(Date.now() + f.days * DAY_MS), status: "active", dataMode: project.dataMode });
    const split: Record<string, number> = { research: 0.04, services: 0.03, kol: 0.45, bounty: 0.1, content: 0.28, community: 0.1 };
    await db.insert(s.missionBudgets).values(Object.entries(split).map(([category, pct]) => ({ id: newId(), missionId, category, allocatedMicro: Math.floor(budget * pct) })));
    await db.update(s.projects).set({ onboardingStep: Math.max(project.onboardingStep, 4) }).where(eq(s.projects.id, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "mission.create", data: { template: f.template, goal: f.goal, budget: f.budget } });
    revalidatePath("/onboarding");
    revalidatePath("/app", "layout");
    return { ok: true, data: { done: project.onboardingStep >= 5 } };
  } catch (e) {
    return fail(e);
  }
}

const AutonomyForm = z.object({
  maxTransaction: z.string().regex(/^\d+(\.\d{1,6})?$/),
  dailySpend: z.string().regex(/^\d+(\.\d{1,6})?$/),
  kolThreshold: z.string().regex(/^\d+(\.\d{1,6})?$/),
  bountyThreshold: z.string().regex(/^\d+(\.\d{1,6})?$/),
  hardCeiling: z.string().regex(/^\d+(\.\d{1,6})?$/),
  autopilot: z.enum(["off", "hourly", "every_6h", "daily"]),
});

/** Step 4: the founder's hard rules. Activates the workspace and queues its first scan. */
export async function onboardAutonomyAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    // Activation writes a fresh policy from defaults; on a live workspace that would silently reset
    // categories and chains without a version bump. Policy changes after setup go through Settings.
    if (project.onboardingStep >= 5) return { ok: false, error: "This workspace is already active — change spend rules in Settings → Spend policy" };
    const f = AutonomyForm.parse(Object.fromEntries(["maxTransaction", "dailySpend", "kolThreshold", "bountyThreshold", "hardCeiling", "autopilot"].map((k) => [k, String(form.get(k) ?? "")])));
    const values = {
      ...DEFAULT_POLICY,
      maxTransactionMicro: toMicro(f.maxTransaction),
      dailySpendMicro: toMicro(f.dailySpend),
      kolApprovalThresholdMicro: toMicro(f.kolThreshold),
      bountyApprovalThresholdMicro: toMicro(f.bountyThreshold),
      hardCeilingMicro: toMicro(f.hardCeiling),
    };
    if (values.maxTransactionMicro > values.hardCeilingMicro) return { ok: false, error: "The autonomous limit cannot exceed the hard ceiling" };
    await db.insert(s.policies).values({ id: newId(), projectId: project.id, ...values }).onConflictDoUpdate({ target: s.policies.projectId, set: values });
    await db.update(s.projects).set({ onboardingStep: 5, autopilot: f.autopilot }).where(eq(s.projects.id, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "workspace.activate", data: { autopilot: f.autopilot } });
    // Discovery only: the first run never spends, whatever the policy allows.
    await enqueue(db, { kind: "scan", projectId: project.id, trigger: "user", dedupeKey: `first-scan:${project.id}` });
    kickWorker();
  } catch (e) {
    return fail(e);
  }
  redirect("/app?welcome=1");
}
