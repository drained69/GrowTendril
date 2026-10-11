"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { PROJECT_COOKIE } from "@/server/auth/session";
import { analyzeProduct, ProductProfileSchema } from "@/server/domain/intel/product-analyst";
import { BudgetCategory } from "@/server/domain/agent/actions";
import { ACTIVE_CHAINS, chainLabel } from "@/server/integrations/circle/config";
import { newId } from "@/server/lib/ids";
import { toMicro } from "@/lib/money";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

const Amount = z.string().regex(/^\d+(\.\d{1,6})?$/, "Enter a USDC amount");
const PolicyForm = z.object({
  maxTransaction: Amount,
  dailySpend: Amount,
  kolThreshold: Amount,
  bountyThreshold: Amount,
  hardCeiling: Amount,
  autonomous: z.array(BudgetCategory),
  approval: z.array(BudgetCategory),
  chains: z.array(z.string()).min(1, "Allow at least one chain"),
});

export async function updatePolicyAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = PolicyForm.parse({
      maxTransaction: form.get("maxTransaction"),
      dailySpend: form.get("dailySpend"),
      kolThreshold: form.get("kolThreshold"),
      bountyThreshold: form.get("bountyThreshold"),
      hardCeiling: form.get("hardCeiling"),
      autonomous: form.getAll("autonomous").map(String),
      approval: form.getAll("approval").map(String),
      chains: form.getAll("chains").map(String),
    });
    // Only this deployment's network: a chain from the other network could never pass the engine's ACTIVE_NETWORK check.
    const offNetwork = f.chains.filter((c) => !(ACTIVE_CHAINS as readonly string[]).includes(c));
    if (offNetwork.length) return { ok: false, error: `Not available on this network: ${offNetwork.map(chainLabel).join(", ")}` };
    const overlap = f.autonomous.filter((c) => f.approval.includes(c));
    if (overlap.length) return { ok: false, error: `A category can't be both autonomous and approval-gated: ${overlap.join(", ")}` };
    const vals = {
      maxTransactionMicro: toMicro(f.maxTransaction),
      dailySpendMicro: toMicro(f.dailySpend),
      kolApprovalThresholdMicro: toMicro(f.kolThreshold),
      bountyApprovalThresholdMicro: toMicro(f.bountyThreshold),
      hardCeilingMicro: toMicro(f.hardCeiling),
      autonomousCategories: f.autonomous,
      approvalCategories: f.approval,
      allowedChains: f.chains,
    };
    if (vals.maxTransactionMicro > vals.hardCeilingMicro) return { ok: false, error: "The autonomous limit cannot exceed the hard ceiling" };
    const [cur] = await db.select().from(s.policies).where(eq(s.policies.projectId, project.id));
    await db.update(s.policies).set({ ...vals, version: (cur?.version ?? 1) + 1, updatedAt: new Date() }).where(eq(s.policies.projectId, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "policy.update", data: vals as Record<string, unknown> });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Policy saved (v${(cur?.version ?? 1) + 1})` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveProfileAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_workspace");
    const list = (k: string) => String(form.get(k) ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    const profile = ProductProfileSchema.parse({
      summary: String(form.get("summary") ?? ""),
      category: String(form.get("category") ?? ""),
      targetUsers: list("targetUsers"),
      competitors: list("competitors"),
      valueProps: list("valueProps"),
      integrations: list("integrations"),
      useCases: list("useCases"),
      pricing: String(form.get("pricing") ?? "") || null,
      terminology: list("terminology"),
      keywords: list("keywords"),
    });
    if (!profile.keywords.length) return { ok: false, error: "Add at least one discovery search term" };
    await db.update(s.productProfiles).set({ ...profile, founderEdited: true, updatedAt: new Date() }).where(eq(s.productProfiles.projectId, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "profile.update" });
    revalidatePath("/app", "layout");
    revalidatePath("/onboarding");
    return { ok: true, message: "Profile saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function saveIcpAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db } = await guard("manage_workspace");
    for (const id of form.getAll("icpId").map(String)) {
      const list = (k: string) => String(form.get(`${k}:${id}`) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      await db
        .update(s.icps)
        .set({ title: String(form.get(`title:${id}`) ?? ""), description: String(form.get(`description:${id}`) ?? ""), companySize: String(form.get(`companySize:${id}`) ?? "") || null, segments: list("segments"), signals: list("signals") })
        .where(and(eq(s.icps.id, id), eq(s.icps.projectId, project.id)));
    }
    revalidatePath("/onboarding");
    revalidatePath("/app/settings");
    return { ok: true, message: "ICP saved" };
  } catch (e) {
    return fail(e);
  }
}

const WorkspaceForm = z.object({
  name: z.string().trim().min(1).max(80),
  website: z.string().url().max(300).optional(),
  docsUrl: z.string().url().max(300).optional(),
  githubUrl: z.string().url().max(300).optional(),
  xHandle: z.string().max(60).optional(),
});

export async function updateWorkspaceAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_workspace");
    const opt = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const f = WorkspaceForm.parse({ name: form.get("name"), website: opt("website"), docsUrl: opt("docsUrl"), githubUrl: opt("githubUrl"), xHandle: opt("xHandle")?.replace(/^@/, "") });
    await db.update(s.projects).set({ name: f.name, website: f.website ?? null, docsUrl: f.docsUrl ?? null, githubUrl: f.githubUrl ?? null, xHandle: f.xHandle ?? null }).where(eq(s.projects.id, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "workspace.update" });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Workspace saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function setAutopilotAction(cadence: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    if (!["off", "hourly", "every_6h", "daily"].includes(cadence)) return { ok: false, error: "Unknown cadence" };
    if (project.dataMode === "DEMO" && cadence !== "off") return { ok: false, error: "Autopilot runs on live workspaces only" };
    await db.update(s.projects).set({ autopilot: cadence }).where(eq(s.projects.id, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "autopilot.set", data: { cadence } });
    revalidatePath("/app", "layout");
    return { ok: true, message: cadence === "off" ? "Autopilot off" : "Autopilot on" };
  } catch (e) {
    return fail(e);
  }
}

export async function rotateWebhookSecretAction(): Promise<ActionResult<{ secret: string }>> {
  try {
    const { project, db, user } = await guard("manage_integrations");
    const secret = randomBytes(32).toString("hex");
    await db.update(s.projects).set({ webhookSecret: secret }).where(eq(s.projects.id, project.id));
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "webhook.rotate" });
    revalidatePath("/app/integrations");
    return { ok: true, data: { secret }, message: "Secret rotated — update your product's sender" };
  } catch (e) {
    return fail(e);
  }
}

/** Re-reads the workspace's public pages and replaces the product profile with a fresh draft. */
export async function reprofileAction(): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_workspace");
    if (user.isGuest || project.dataMode === "DEMO") return { ok: false, error: "Demo workspaces aren't re-read — their product is fictional." };
    await limited(`reprofile:${project.id}`, 3, 0.01);
    if (!project.website && !project.docsUrl && !project.githubUrl) return { ok: false, error: "Add a website, docs or GitHub URL first, and save the workspace." };
    const analysis = await analyzeProduct({ name: project.name, website: project.website, docsUrl: project.docsUrl, xHandle: project.xHandle, githubUrl: project.githubUrl, description: project.description || project.name });
    const values = { ...analysis.profile, crawledSources: analysis.crawled, generatedBy: analysis.generatedBy, founderEdited: false, updatedAt: new Date() };
    await db.insert(s.productProfiles).values({ id: newId(), projectId: project.id, ...values }).onConflictDoUpdate({ target: s.productProfiles.projectId, set: values });
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "profile.reprofile", data: { generatedBy: analysis.generatedBy, sources: analysis.crawled.length } });
    revalidatePath("/app", "layout");
    return { ok: true, message: analysis.note };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Permanently deletes the workspace (owners only; every child row cascades). Refused while it
 * holds an agent wallet or has payments in flight: deleting would drop GrowTendril's only record of
 * a wallet that may still hold USDC.
 */
export async function deleteWorkspaceAction(confirmName: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_workspace");
    if (confirmName.trim() !== project.name) return { ok: false, error: "Type the workspace name exactly to confirm" };
    const [wallet] = await db.select({ provider: s.wallets.provider, address: s.wallets.address }).from(s.wallets).where(eq(s.wallets.projectId, project.id));
    if (wallet && (wallet.address || wallet.provider !== "unconfigured"))
      return { ok: false, error: "This workspace has an agent wallet. Deleting it would lose GrowTendril's record of that wallet and any USDC in it — freeze the wallet instead, or contact the operator of this deployment." };
    const [inflight] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.transactions)
      .where(and(eq(s.transactions.projectId, project.id), inArray(s.transactions.state, ["AUTHORIZED", "EXECUTING", "SUBMITTED"])));
    if ((inflight?.n ?? 0) > 0) return { ok: false, error: "Payments are in flight — wait for them to settle before deleting" };
    await db.delete(s.projects).where(eq(s.projects.id, project.id));
    (await cookies()).delete(PROJECT_COOKIE);
  } catch (e) {
    return fail(e);
  }
  redirect("/app");
}
