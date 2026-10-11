import { NextResponse } from "next/server";
import { currentProject, currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { latestCreatorReport, reportCsv, reportMarkdown } from "@/server/domain/growth/creator-report";

export const dynamic = "force-dynamic";

/** Download the latest influencer report as Markdown or CSV. */
export async function GET(req: Request) {
  const user = await currentUser();
  const cur = user ? await currentProject(user.id) : null;
  if (!cur || !user?.emailVerified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await latestCreatorReport(await getDb(), cur.project.id);
  if (!report) return NextResponse.json({ error: "No report yet" }, { status: 404 });
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const slug = cur.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  const body = csv ? reportCsv(report) : reportMarkdown(report);
  return new NextResponse(body, {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-influencer-report.${csv ? "csv" : "md"}"`,
      "Cache-Control": "no-store",
    },
  });
}
