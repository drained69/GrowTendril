"use server";

import { revalidatePath } from "next/cache";
import { saveIntegration, removeIntegration, testIntegration } from "@/server/integrations/vault";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

export async function saveIntegrationAction(providerId: string, fields: Record<string, string>): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_integrations");
    await saveIntegration(db, { projectId: project.id, providerId, fields, userId: user.id });
    const t = await testIntegration(db, { projectId: project.id, providerId });
    revalidatePath("/app/integrations");
    return t.ok ? { ok: true, message: t.message } : { ok: true, message: `Saved, but the test failed: ${t.message}` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeIntegrationAction(providerId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_integrations");
    await removeIntegration(db, { projectId: project.id, providerId, userId: user.id });
    revalidatePath("/app/integrations");
    return { ok: true, message: "Disconnected" };
  } catch (e) {
    return fail(e);
  }
}

export async function testIntegrationAction(providerId: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_integrations");
    await limited(`test-int:${user.id}`, 6, 0.1);
    const r = await testIntegration(db, { projectId: project.id, providerId });
    revalidatePath("/app/integrations");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) {
    return fail(e);
  }
}
