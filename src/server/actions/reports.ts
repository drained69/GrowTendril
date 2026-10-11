"use server";

import { latestCreatorReport, reportMarkdown } from "@/server/domain/growth/creator-report";
import { buildGrowthPlan, planMarkdown } from "@/server/domain/growth/plan";
import { sendEmail } from "@/server/integrations/email";
import { appOrigin } from "@/server/lib/origin";
import { fail, guard, limited, type ActionResult } from "@/server/actions/_common";

/** Email the influencer report or the growth plan to the signed-in person's verified address. */
export async function emailReportAction(kind: "creators" | "plan"): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("view");
    await limited(`email-report:${user.id}`, 3, 0.01);
    const origin = await appOrigin();
    let subject: string;
    let text: string;
    let url: string;
    if (kind === "creators") {
      const report = await latestCreatorReport(db, project.id);
      if (!report) return { ok: false, error: "There's no influencer report yet — build it first." };
      subject = `Influencer report — ${project.name}`;
      text = reportMarkdown(report);
      url = `${origin}/app/kols/report`;
    } else {
      subject = `Growth plan — ${project.name}`;
      text = planMarkdown(project.name, await buildGrowthPlan(db, project.id));
      url = `${origin}/app/plan`;
    }
    const r = await sendEmail(db, { to: user.email, userId: user.id, kind: "report", subject, text: text.slice(0, 90_000), action: { label: "Open in GrowTendril", url } });
    return { ok: true, message: r.delivered ? `Sent to ${user.email}` : `Email isn't configured here — printed to the server console for ${user.email}` };
  } catch (e) {
    return fail(e);
  }
}
