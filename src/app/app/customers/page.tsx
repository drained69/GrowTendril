import { desc, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { relTime } from "@/lib/time";
import { Card, Confidence, EmptyState, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge } from "@/components/ui";
import { RunScanButton } from "@/components/features/intel/run-scan-button";
import { DataTable } from "@/components/ui/data-table";

const score = (v: number, strong = 70) => <span className={`num ${v >= strong ? "text-ink" : v >= 45 ? "text-ink-2" : "text-ink-4"}`}>{v}</span>;

export default async function Customers() {
  const { project, role, db } = await requireProject();
  const rows = await db.select().from(s.companies).where(eq(s.companies.projectId, project.id)).orderBy(desc(s.companies.overallScore));
  const qualified = rows.filter((c) => c.status === "qualified").length;
  const committable = rows.filter((c) => c.confidence >= 0.8).length;
  const avgIntent = rows.length ? Math.round(rows.reduce((a, c) => a + c.intentScore, 0) / rows.length) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Companies showing evidence of buying intent — not a contact list. Scores are transparent weighted components; confidence rises only when evidence quality does."
        meta={<ModeBadge mode={project.dataMode} />}
      />

      {rows.length > 0 && (
        <StatStrip className="grid-cols-2 sm:grid-cols-4">
          <Stat label="Companies tracked" value={rows.length} />
          <Stat label="Qualified" value={qualified} sub="status = qualified" tone={qualified ? "good" : undefined} />
          <Stat label="Above commit threshold" value={committable} sub="confidence ≥ 80%" />
          <Stat label="Avg. intent" value={avgIntent} sub="0–100" />
        </StatStrip>
      )}

      {rows.length ? (
        <Card>
          <DataTable
            searchable
            defaultSort={{ key: "overall", dir: "desc" }}
            columns={[
              { key: "name", label: "Company", sortable: true },
              { key: "overall", label: "Overall", align: "right", sortable: true },
              { key: "intent", label: "Intent", align: "right", sortable: true },
              { key: "fit", label: "Fit", align: "right", sortable: true },
              { key: "confidence", label: "Confidence", sortable: true },
              { key: "why", label: "Why now", className: "max-w-[380px]" },
              { key: "status", label: "Status", sortable: true },
              { key: "updated", label: "Updated", align: "right", sortable: true },
            ]}
            rows={rows.map((c) => ({
              id: c.id,
              href: `/app/customers/${c.id}`,
              cells: {
                name: (
                  <span className="flex items-center gap-2">
                    {c.name}
                    <ModeBadge mode={c.dataMode} />
                  </span>
                ),
                overall: <span className="num text-[13.5px] font-medium text-ink">{c.overallScore}</span>,
                intent: score(c.intentScore),
                fit: score(c.fitScore),
                confidence: <Confidence value={c.confidence} />,
                why: <span className="block truncate text-ink-2">{c.whyNow[0] ?? "—"}</span>,
                status: <StatusBadge status={c.status} />,
                updated: <span className="text-[11.5px] text-ink-3">{relTime(c.updatedAt)}</span>,
              },
              sort: { name: c.name, overall: c.overallScore, intent: c.intentScore, fit: c.fitScore, confidence: c.confidence, status: c.status, updated: c.updatedAt.getTime() },
              search: `${c.name} ${c.status} ${c.whyNow.join(" ")}`,
            }))}
            empty={<p className="text-center text-[12.5px] text-ink-3">No companies match that filter.</p>}
          />
        </Card>
      ) : (
        <EmptyState
          icon={<Building2 />}
          title="No companies with intent signals yet"
          description="Companies appear here when a scan finds public evidence of buying intent — recommendation requests, migrations, hiring or funding tied to your category."
          action={
            <RunScanButton canOperate={can(role, "operate")} />
          }
        />
      )}
    </div>
  );
}
