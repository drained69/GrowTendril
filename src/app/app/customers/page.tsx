import { desc, eq } from "drizzle-orm";
import { ArrowUpRight, Building2, MessageCircle, Radar } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { relTime } from "@/lib/time";
import { Badge, Card, CardBody, CardHeader, Confidence, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { customerConversations } from "@/server/queries/customer-conversations";

const score = (v: number, strong = 70) => <span className={`num ${v >= strong ? "text-ink" : v >= 45 ? "text-ink-2" : "text-ink-4"}`}>{v}</span>;

export default async function Customers() {
  const { project, db } = await requireProject();
  const [rows, people, [profile]] = await Promise.all([
    db.select().from(s.companies).where(eq(s.companies.projectId, project.id)).orderBy(desc(s.companies.overallScore)),
    customerConversations(db, project.id),
    db.select({ audience: s.productProfiles.audience }).from(s.productProfiles).where(eq(s.productProfiles.projectId, project.id)),
  ]);
  const consumer = profile?.audience === "consumers";
  const qualified = rows.filter((c) => c.status === "qualified").length;
  const committable = rows.filter((c) => c.confidence >= 0.8).length;
  const avgIntent = rows.length ? Math.round(rows.reduce((a, c) => a + c.intentScore, 0) / rows.length) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description={consumer ? "People asking for recommendations or comparing products in your category. Read the original conversation, review the fit and choose a helpful next step." : "Companies and people showing evidence of buying intent. Review the source context and score breakdown before choosing who to contact."}
        meta={<ModeBadge mode={project.dataMode} />}
      />

      {(consumer || people.length > 0) && (
        <Card>
          <CardHeader title="People asking in public" description="Conversations the operator identified as potential customer signals. You review and send any reply." icon={<MessageCircle />} action={<Badge>{people.length}{people.length === 100 ? "+" : ""} {people.length === 1 ? "signal" : "signals"}</Badge>} />
          {people.length ? (
            <ul className="divide-y divide-line">
              {people.map(({ opportunity: o, post }) => (
                <li key={o.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3"><Badge>{post?.provider ?? "Customer signal"}</Badge>{post && <span>@{post.author} · {relTime(post.publishedAt)}</span>}<ModeBadge mode={o.dataMode} /><span className="ml-auto"><Confidence value={o.confidence} /></span></div>
                  <h3 className="mt-2 text-[14px] font-medium leading-snug text-ink">{o.title}</h3>
                  <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2">{post ? `${post.content.slice(0, 360)}${post.content.length > 360 ? "…" : ""}` : o.whyNow[0]}</p>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-3"><span className="font-medium text-ink-2">Suggested next step:</span> {o.recommendedAction}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {post && /^https?:\/\//i.test(post.url) ? <LinkButton href={post.url} external icon={<ArrowUpRight />} variant="outline">Original conversation</LinkButton> : <span className="text-[11.5px] text-ink-3">Original post not linked</span>}
                    <LinkButton href={`/app/opportunities/${encodeURIComponent(o.id)}`}>Review opportunity</LinkButton>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody><EmptyState icon={<MessageCircle />} title="No customer conversations yet" description="A scan looks for people asking for recommendations, comparing alternatives or discussing a problem your product solves." action={<LinkButton href="/app/discover" icon={<Radar />}>Review market sources</LinkButton>} /></CardBody>
          )}
        </Card>
      )}

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
      ) : !consumer && people.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No companies with intent signals yet"
          description="Companies appear here when a scan finds public evidence of buying intent — recommendation requests, migrations, hiring or funding tied to your category."
          action={
            <LinkButton href="/app/runs" variant="primary" icon={<Radar />}>
              Run a scan
            </LinkButton>
          }
        />
      ) : null}
    </div>
  );
}
