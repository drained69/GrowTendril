import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { TrendingUp } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { DAY_MS } from "@/lib/time";
import { Badge, Card, CardHeader, EmptyState, ModeBadge, PageHeader, Velocity, type Tone } from "@/components/ui";
import { RunScanButton } from "@/components/features/intel/run-scan-button";
import { DataTable } from "@/components/ui/data-table";
import { Sparkline } from "@/components/charts";

const STATUS_TONE: Record<string, Tone> = { EMERGING: "accent", ACCELERATING: "good", PEAKING: "warn", DECLINING: "bad", CONTROVERSIAL: "warn", UNDEREXPLORED: "info", STABLE: "neutral" };
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default async function Narratives() {
  const { project, role, db } = await requireProject();
  const [rows, links] = await Promise.all([
    db.select().from(s.narratives).where(eq(s.narratives.projectId, project.id)).orderBy(desc(s.narratives.relevance), desc(s.narratives.volume7d)),
    db.select({ n: s.narrativePosts.narrativeId, at: s.socialPosts.publishedAt }).from(s.narrativePosts).innerJoin(s.socialPosts, eq(s.narrativePosts.postId, s.socialPosts.id)).where(eq(s.socialPosts.projectId, project.id)),
  ]);
  const series = (id: string) => Array.from({ length: 14 }, (_, i) => links.filter((l) => l.n === id && Math.floor((Date.now() - l.at.getTime()) / DAY_MS) === 13 - i).length);
  const top = rows.filter((r) => r.relevance >= 40).slice(0, 6);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Narratives"
        description="Public conversation clustered into themes. Week-over-week volume decides the lifecycle; relevance is overlap with the product's own vocabulary."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>
              <span className="num text-ink-2">{rows.length}</span> narratives tracked
            </span>
          </>
        }
      />

      {top.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Your market this week" description="Most relevant narratives, by overlap with your product vocabulary" icon={<TrendingUp />} />
          <div className="-mb-px -mr-px grid sm:grid-cols-2 lg:grid-cols-3">
            {top.map((n) => (
              <Link key={n.id} href={`/app/narratives/${n.id}`} className="group flex flex-col gap-2 border-b border-line px-4 py-3 transition-colors hover:bg-surface-2 border-r">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">{n.label}</span>
                  <Velocity pct={n.velocityPct} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                    <Badge tone={STATUS_TONE[n.status]}>{title(n.status)}</Badge>
                    <span>
                      <span className="num">{n.volume7d}</span> posts · rel <span className="num">{n.relevance}</span>
                    </span>
                  </span>
                  <Sparkline values={series(n.id)} width={84} height={20} label={n.label} />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {rows.length ? (
        <Card>
          <DataTable
            searchable
            defaultSort={{ key: "relevance", dir: "desc" }}
            columns={[
              { key: "label", label: "Narrative", sortable: true },
              { key: "status", label: "Lifecycle", sortable: true },
              { key: "v7", label: "7d", align: "right", sortable: true },
              { key: "prev", label: "Prior 7d", align: "right", sortable: true },
              { key: "velocity", label: "Velocity", align: "right", sortable: true },
              { key: "relevance", label: "Relevance", align: "right", sortable: true },
              { key: "trend", label: "14 days" },
              { key: "mode", label: "", align: "right" },
            ]}
            rows={rows.map((n) => ({
              id: n.id,
              href: `/app/narratives/${n.id}`,
              cells: {
                label: (
                  <span className="block min-w-[200px]">
                    {n.label}
                    <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-3">{n.terms.slice(0, 5).join(" · ")}</span>
                  </span>
                ),
                status: (
                  <span className="block max-w-[260px]">
                    <Badge tone={STATUS_TONE[n.status]}>{title(n.status)}</Badge>
                    {n.summary && <span className="mt-1 line-clamp-1 block text-[11px] text-ink-3">{n.summary}</span>}
                  </span>
                ),
                v7: <span className="num">{n.volume7d}</span>,
                prev: <span className="num text-ink-3">{n.volumePrev7d}</span>,
                velocity: <Velocity pct={n.velocityPct} />,
                relevance: <span className="num">{n.relevance}</span>,
                trend: <Sparkline values={series(n.id)} width={110} height={22} label={n.label} />,
                mode: <ModeBadge mode={n.dataMode} />,
              },
              sort: { label: n.label, status: n.status, v7: n.volume7d, prev: n.volumePrev7d, velocity: n.velocityPct, relevance: n.relevance },
              search: `${n.label} ${n.status} ${n.terms.join(" ")} ${n.summary ?? ""}`,
            }))}
          />
        </Card>
      ) : (
        <EmptyState
          icon={<TrendingUp />}
          title="No narratives yet"
          description="Narratives form once enough relevant public posts cluster around a theme. Connect sources and run a scan to collect them."
          action={
            <RunScanButton canOperate={can(role, "operate")} />
          }
        />
      )}
    </div>
  );
}
