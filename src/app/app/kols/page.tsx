import { desc, eq } from "drizzle-orm";
import { Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import type { ScoreComponent } from "@/server/domain/scoring/intent";
import { Avatar, Card, EmptyState, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge } from "@/components/ui";
import { RunScanButton } from "@/components/features/intel/run-scan-button";
import { DataTable } from "@/components/ui/data-table";

const COLS: [string, string][] = [
  ["audienceFit", "Audience"],
  ["topicAuthority", "Authority"],
  ["recentRelevance", "Recent"],
  ["engagementQuality", "Engage"],
  ["narrativeFit", "Narrative"],
  ["historicalProductFit", "History"],
  ["authenticity", "Authentic"],
  ["campaignFit", "Campaign"],
];

function cell(v?: number) {
  if (v == null) return <span className="text-ink-4">—</span>;
  const tone = v >= 75 ? "text-ink" : v >= 50 ? "text-ink-2" : "text-ink-4";
  return <span className={`num ${tone}`}>{v}</span>;
}

export default async function Creators() {
  const { project, role, db } = await requireProject();
  const rows = await db.select().from(s.kols).where(eq(s.kols.projectId, project.id)).orderBy(desc(s.kols.overallScore));
  const strong = rows.filter((k) => k.overallScore >= 70).length;
  const engaged = rows.filter((k) => k.status !== "candidate" && k.status !== "dismissed").length;
  const withPayout = rows.filter((k) => k.payoutAddress).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Creators"
        description="Ranked by relevance, authority, recency, discussion quality and authenticity. Follower count is shown, but only enters scoring log-damped (max +10 on authority)."
        meta={<ModeBadge mode={project.dataMode} />}
      />

      {rows.length > 0 && (
        <StatStrip className="grid-cols-2 sm:grid-cols-4">
          <Stat label="Creators ranked" value={rows.length} />
          <Stat label="Strong fit" value={strong} sub="overall ≥ 70" tone={strong ? "good" : undefined} />
          <Stat label="Shortlisted / engaged" value={engaged} />
          <Stat label="Payout address set" value={withPayout} sub="ready to pay in USDC" />
        </StatStrip>
      )}

      {rows.length ? (
        <Card>
          <DataTable
            searchable
            defaultSort={{ key: "overall", dir: "desc" }}
            columns={[
              { key: "handle", label: "Creator", sortable: true },
              { key: "followers", label: "Followers", align: "right", sortable: true },
              ...COLS.map(([key, label]) => ({ key, label, align: "right" as const, sortable: true })),
              { key: "overall", label: "Overall", align: "right", sortable: true },
              { key: "status", label: "", align: "right" },
            ]}
            rows={rows.map((k) => {
              const m = k.metrics as Record<string, ScoreComponent>;
              return {
                id: k.id,
                href: `/app/kols/${k.id}`,
                cells: {
                  handle: (
                    <span className="flex items-center gap-2.5">
                      <Avatar name={k.handle} size={22} />
                      <span className="min-w-0">
                        <span className="block">@{k.handle}</span>
                        <span className="block text-[11px] font-normal text-ink-3">{k.provider}</span>
                      </span>
                    </span>
                  ),
                  followers: <span className="num text-ink-3">{k.followers ? k.followers.toLocaleString() : "—"}</span>,
                  ...Object.fromEntries(COLS.map(([key]) => [key, cell(m[key]?.score)])),
                  overall: <span className="num text-[13.5px] font-medium text-ink">{k.overallScore}</span>,
                  status: (
                    <span className="inline-flex items-center gap-1.5">
                      {k.status !== "candidate" && <StatusBadge status={k.status} />}
                      <ModeBadge mode={k.dataMode} />
                    </span>
                  ),
                },
                sort: { handle: k.handle, followers: k.followers ?? null, overall: k.overallScore, ...Object.fromEntries(COLS.map(([key]) => [key, m[key]?.score ?? null])) },
                search: `${k.handle} ${k.provider} ${k.status}`,
              };
            })}
            empty={<p className="text-center text-[12.5px] text-ink-3">No creators match that filter.</p>}
          />
        </Card>
      ) : (
        <EmptyState
          icon={<Users />}
          title="No relevant creators yet"
          description="Creators are ranked from the authors of relevant public posts. Run a scan and the voices that keep coming up in your narratives appear here."
          action={
            <RunScanButton canOperate={can(role, "operate")} />
          }
        />
      )}
    </div>
  );
}
