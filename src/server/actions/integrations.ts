"use server";

import { revalidatePath } from "next/cache";
import { saveIntegration, removeIntegration, testIntegration } from "@/server/integrations/vault";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

/** Guest accounts and DEMO workspaces are throwaway and public-facing: they can't store credentials or point GrowthOS at URLs. */
function sandboxed(g: { user: { isGuest: boolean }; project: { dataMode: string } }): string | null {
  if (g.user.isGuest) return "Guest accounts can't change integrations — create an account first.";
  if (g.project.dataMode === "DEMO") return "Demo workspaces can't change integrations. Set up your own workspace to connect sources.";
  return null;
}

// Providers that fetch URLs supplied by the workspace.
const URL_PROVIDERS = new Set(["rss"]);

export async function saveIntegrationAction(providerId: string, fields: Record<string, string>): Promise<ActionResult> {
  try {
    const g = await guard("manage_integrations");
    const blocked = sandboxed(g);
    if (blocked) return { ok: false, error: blocked };
    await limited(`save-int:${g.user.id}`, 10, 0.1);
    await saveIntegration(g.db, { projectId: g.project.id, providerId, fields, userId: g.user.id });
    const t = await testIntegration(g.db, { projectId: g.project.id, providerId });
    revalidatePath("/app/integrations");
    return t.ok ? { ok: true, message: t.message } : { ok: true, message: `Saved, but the test failed: ${t.message}` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeIntegrationAction(providerId: string): Promise<ActionResult> {
  try {
    const g = await guard("manage_integrations");
    const blocked = sandboxed(g);
    if (blocked) return { ok: false, error: blocked };
    await removeIntegration(g.db, { projectId: g.project.id, providerId, userId: g.user.id });
    revalidatePath("/app/integrations");
    return { ok: true, message: "Disconnected" };
  } catch (e) {
    return fail(e);
  }
}

export async function testIntegrationAction(providerId: string): Promise<ActionResult> {
  try {
    const g = await guard("view");
    if (URL_PROVIDERS.has(providerId)) {
      const blocked = sandboxed(g);
      if (blocked) return { ok: false, error: blocked };
    }
    await limited(`test-int:${g.user.id}`, 6, 0.1);
    const r = await testIntegration(g.db, { projectId: g.project.id, providerId });
    revalidatePath("/app/integrations");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) {
    return fail(e);
  }
}
