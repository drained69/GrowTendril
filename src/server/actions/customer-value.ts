"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { audit } from "@/server/db/helpers";
import { schema as s } from "@/server/db/client";
import { fail, guard, type ActionResult } from "@/server/actions/_common";

const DefinitionsForm = z.object({
  activationEvent: z.enum(CONVERSION_EVENTS).refine((e) => e !== "visit", "A link visit can't mean activated — choose a customer action"),
  repeatWindowDays: z.coerce.number().int().min(7, "At least 7 days").max(730, "At most 730 days"),
  grossMarginPct: z.union([z.literal(""), z.coerce.number().int().min(1, "Margin must be 1–100%").max(100, "Margin must be 1–100%")]).default(""),
});

/** Saves how cohorts are defined and the gross-margin assumption used for estimates. */
export async function saveCustomerValueDefinitionsAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = DefinitionsForm.parse(Object.fromEntries(form.entries()));
    const margin = f.grossMarginPct === "" ? null : f.grossMarginPct;
    const values = { activationEvent: f.activationEvent, repeatWindowDays: f.repeatWindowDays, grossMarginPct: margin, updatedBy: user.id, updatedAt: new Date() };
    await db.insert(s.customerValueSettings).values({ projectId: project.id, ...values }).onConflictDoUpdate({ target: s.customerValueSettings.projectId, set: values });
    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "customer_value.definitions", data: { activationEvent: f.activationEvent, repeatWindowDays: f.repeatWindowDays, grossMarginPct: margin } });
    revalidatePath("/app/customer-value", "layout");
    return { ok: true, message: "Definitions saved — every campaign is recalculated with them" };
  } catch (e) {
    return fail(e);
  }
}
