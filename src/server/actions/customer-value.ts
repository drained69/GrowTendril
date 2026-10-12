"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CONVERSION_EVENTS } from "@/server/domain/growth/attribution-links";
import { audit } from "@/server/db/helpers";
import { schema as s } from "@/server/db/client";
import { fail, guard, type ActionResult } from "@/server/actions/_common";

const DefinitionsForm = z.object({
  activationEvent: z.enum(CONVERSION_EVENTS).refine((e) => e !== "visit", "A link visit can't mean activated — choose a customer action"),
  repeatWindowDays: z.coerce.number().int().min(7, "At least 7 days").max(730, "At most 730 days"),
  grossMarginPct: z.union([z.literal(""), z.coerce.number().int().min(1).max(100)]).default(""),
});

/** Saves how cohorts are defined, and the gross-margin assumption (shared with Settings → Economics). */
export async function saveCustomerValueDefinitionsAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("manage_policy");
    const f = DefinitionsForm.parse(Object.fromEntries(form.entries()));
    const values = { activationEvent: f.activationEvent, repeatWindowDays: f.repeatWindowDays, updatedBy: user.id, updatedAt: new Date() };
    await db.insert(s.customerValueSettings).values({ projectId: project.id, ...values }).onConflictDoUpdate({ target: s.customerValueSettings.projectId, set: values });

    // Margin lives in project economics so the campaign planner and this view use one figure.
    const margin = f.grossMarginPct === "" ? null : f.grossMarginPct;
    const [econ] = await db.select({ margin: s.projectEconomics.grossMarginPct }).from(s.projectEconomics).where(eq(s.projectEconomics.projectId, project.id));
    if (econ && econ.margin !== margin) await db.update(s.projectEconomics).set({ grossMarginPct: margin, updatedBy: user.id, updatedAt: new Date() }).where(eq(s.projectEconomics.projectId, project.id));
    else if (!econ && margin != null) await db.insert(s.projectEconomics).values({ projectId: project.id, grossMarginPct: margin, updatedBy: user.id });

    await audit(db, { projectId: project.id, actorType: "user", actorId: user.id, action: "customer_value.definitions", data: { activationEvent: f.activationEvent, repeatWindowDays: f.repeatWindowDays, grossMarginPct: margin } });
    revalidatePath("/app/customer-value", "layout");
    revalidatePath("/app/settings");
    return { ok: true, message: "Definitions saved — every campaign is recalculated with them" };
  } catch (e) {
    return fail(e);
  }
}
