import { NextResponse } from "next/server";
import { currentProject, currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { buildGrowthPlan, planMarkdown } from "@/server/domain/growth/plan";

export const dynamic = "force-dynamic";

/** Download the current growth plan as Markdown. */
export async function GET() {
  const user = await currentUser();
  const cur = user ? await currentProject(user.id) : null;
  if (!cur || !user?.emailVerified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const plan = await buildGrowthPlan(await getDb(), cur.project.id);
  const slug = cur.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  return new NextResponse(planMarkdown(cur.project.name, plan), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-growth-plan.md"`, "Cache-Control": "no-store" },
  });
}
