"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { schema as s } from "@/server/db/client";
import { resolveApproval, type ApprovalResolution } from "@/server/domain/agent/execute";
import { collector, fail, guard, type ActionResult } from "@/server/actions/_common";

/** Only owners and admins may resolve spend approvals. */
export async function resolveApprovalAction(approvalId: string, resolution: "approve" | "reject", amount?: string, note?: string): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("approve");
    const [ap] = await db.select().from(s.approvals).where(and(eq(s.approvals.id, approvalId), eq(s.approvals.projectId, project.id)));
    if (!ap) return { ok: false, error: "Approval not found" };
    const { log, push } = collector();
    const r = await resolveApproval(db, { approvalId, userId: user.id, resolution, modifiedAmount: amount || undefined, note: note?.slice(0, 500), log: push });
    revalidatePath("/app", "layout");
    return { ok: true, data: r, log, message: resolutionMessage(r) };
  } catch (e) {
    return fail(e);
  }
}

/** Say what actually happened: approval alone is not execution. */
function resolutionMessage(r: ApprovalResolution): string {
  if (r.status === "rejected") return "Rejected";
  if (r.status === "denied") return `Not executed — a deny rule failed at re-check${r.reason ? `: ${r.reason}` : ""}`;
  switch (r.state) {
    case "SETTLED":
      return "Approved — payment settled";
    case "SUBMITTED":
      return "Approved — payment submitted, awaiting settlement";
    case "SIMULATED":
      return "Approved — simulated, no funds moved";
    case "FAILED":
      return `Approved, but execution failed${r.reason ? `: ${r.reason}` : ""}`;
    case "LOCKED":
      return "Approved — another worker is already executing it";
    case "APPLIED":
      return "Approved — budgets reallocated (no funds moved)";
    default:
      return r.state ? `Approved — ${r.state.toLowerCase()}` : "Approved";
  }
}
