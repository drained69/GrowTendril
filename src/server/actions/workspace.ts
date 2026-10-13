"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { schema as s } from "@/server/db/client";
import { audit } from "@/server/db/helpers";
import { ProductProfileSchema } from "@/server/domain/intel/product-analyst";
import { toMicro } from "@/lib/money";
import { fail, guard, type ActionResult } from "@/server/actions/_common";
import { policyValues } from "@/server/domain/workspace/setup";

const Amount = z.string().regex(/^\d+(\.\d{1,6})?$/, "Enter a USDC amount");
const PolicyForm = z.object({
  dailySpend: Amount,
  hardCeiling: Amount,
  autonomousLimit: Amount,
});

export async function updatePolicyAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = PolicyForm.parse({ dailySpend: form.get("dailySpend"), hardCeiling: form.get("hardCeiling"), autonomousLimit: form.get("autonomousLimit") || "0" });
    const ceiling = toMicro(f.hardCeiling);
    if (ceiling <= 0) return { ok: false, error: "Set a positive per-payment ceiling" };
    if (toMicro(f.autonomousLimit) > ceiling) return { ok: false, error: "The autonomous limit can't be higher than the per-payment ceiling" };
    const vals = policyValues(f);
    const version = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${project.id}`}))`);
      const [cur] = await tx.select().from(s.policies).where(eq(s.policies.projectId, project.id)).for("update");
      if (!cur) throw new Error("Finish workspace setup before changing spending rules");
      const nextVersion = cur.version + 1;
      await tx.update(s.policies).set({ ...vals, version: nextVersion, updatedAt: new Date() }).where(eq(s.policies.projectId, project.id));
      await audit(tx as unknown as typeof db, { projectId: project.id, actorType: "user", actorId: user.id, action: "policy.update", data: vals as Record<string, unknown> });
      return nextVersion;
    });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Policy saved (v${version})` };
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
      audience: String(form.get("audience") ?? "businesses"),
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

const WebUrl = z.string().url("Enter a valid web URL").max(300).refine((value) => {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an http:// or https:// URL");
const WorkspaceForm = z.object({
  name: z.string().trim().min(1).max(80),
  website: WebUrl.optional(),
  docsUrl: WebUrl.optional(),
  githubUrl: WebUrl.optional(),
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
