"use server";
import { revalidatePath } from "next/cache";
import { guard, fail, limited, type ActionResult } from "@/server/actions/_common";
import { saveCommerceConnection } from "@/server/domain/growth/commerce";
export async function saveCommerceAction(input: unknown): Promise<ActionResult> {
  try {
    const { db, project, user } = await guard("manage_integrations");
    await limited(`commerce-settings:${user.id}`, 5, 0.1);
    await saveCommerceConnection(db, project.id, user.id, input);
    revalidatePath("/app/integrations");
    return { ok: true, message: "Merchant identity saved. Send signed payment event log pointers to connect orders." };
  } catch (e) { return fail(e); }
}
