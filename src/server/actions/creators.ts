"use server";

import { revalidatePath } from "next/cache";
import { enrichCreators, scoutCreators } from "@/server/domain/growth/creator-scout";
import { analyzeProject } from "@/server/domain/intel/analyze";
import { refreshCreatorReport } from "@/server/domain/intel/discovery";
import { chargeService, refundCharge } from "@/server/domain/billing";
import { newId } from "@/server/lib/ids";
import { collector, fail, guard, limited, type ActionResult } from "@/server/actions/_common";

/** Scout creators now, re-score, read the top profiles and rebuild the influencer report. */
export async function refreshCreatorReportAction(): Promise<ActionResult> {
  try {
    const { project, db, user } = await guard("operate");
    await limited(`creator-report:${user.id}`, 3, 1 / 120);
    const { log, push } = collector();
    const ref = `creator-report:${newId()}`;
    await chargeService(db, { ownerId: project.ownerId, projectId: project.id, service: "creator_report", ref, actorId: user.id });
    let report: Awaited<ReturnType<typeof refreshCreatorReport>>;
    try {
      const scout = await scoutCreators(db, project.id, push, { queries: 4, perQuery: 20, maxCandidates: 16 });
      await analyzeProject(db, project.id, push);
      await enrichCreators(db, project.id, push, { top: 20, cache: scout.cache });
      report = await refreshCreatorReport(db, project.id, push, { forceAi: true });
    } catch (e) {
      await refundCharge(db, ref, "Report failed — refunded");
      throw e;
    }
    revalidatePath("/app", "layout");
    if (!report) {
      await refundCharge(db, ref, "No creators found — refunded");
      return { ok: false, error: "No relevant creators found yet, so nothing was charged. Check your search terms in Settings → Product profile, or connect more sources." };
    }
    return { ok: true, log, message: `Report updated: ${report.totals.creators} creators, ${report.totals.contactFirst} to contact first` };
  } catch (e) {
    return fail(e);
  }
}
