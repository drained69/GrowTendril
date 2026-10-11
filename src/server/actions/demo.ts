"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { sessionCookieOptions, PROJECT_COOKIE } from "@/server/auth/session";
import { seedDemo } from "@/server/demo/seed";
import { runDemoStep, type DemoStepResult } from "@/server/demo/script";
import { can } from "@/server/auth/access";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

export async function runDemoStepAction(step: number): Promise<ActionResult<DemoStepResult>> {
  try {
    const { project, db, user, role } = await guard("operate");
    // Step 6 approves a spend, so it needs the same permission as the Approval Inbox.
    if (step === 6 && !can(role, "approve")) return { ok: false, error: `Your role (${role}) cannot approve spend — ask an owner or admin to run step 6` };
    await limited(`demo-step:${user.id}`, 20, 1);
    const r = await runDemoStep(db, project.id, step, user.id);
    revalidatePath("/app", "layout");
    return { ok: true, data: r, log: r.log };
  } catch (e) {
    return fail(e);
  }
}

export async function resetDemoAction(): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_workspace");
    if (project.dataMode !== "DEMO") return { ok: false, error: "Only demo workspaces can be reset" };
    const id = await seedDemo(db, { reset: true, ownerId: project.ownerId === user.id ? user.id : project.ownerId });
    (await cookies()).set(PROJECT_COOKIE, id, sessionCookieOptions);
    revalidatePath("/app", "layout");
    return { ok: true, message: "Demo reset" };
  } catch (e) {
    return fail(e);
  }
}
