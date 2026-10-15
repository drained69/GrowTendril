import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Lightbulb, Radar } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { EmptyState, LinkButton, ModeBadge, PageHeader, cn } from "@/components/ui";
import { LinkTabs } from "@/components/ui/tabs";
import { OpportunityCards } from "@/components/features/growth/opportunity-cards";

const TYPES = ["ALL", "CUSTOMER", "KOL", "NARRATIVE", "PERSON", "PRODUCT_ISSUE", "COMPETITOR", "PARTNERSHIP", "CONTENT", "COMMUNITY", "EVENT"];
const TYPE_LABEL: Record<string, string> = { ALL: "All", KOL: "Creator", PERSON: "Person asking", PRODUCT_ISSUE: "Product issue" };
const STATUSES = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "dismissed", label: "Dismissed" },
];
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");

export default async function Opportunities({ searchParams }: { searchParams: Promise<{ type?: string; status?: string }> }) {
  const { type = "ALL", status = "active" } = await searchParams;
  const { project, db } = await requireProject();
  const all = await db.select().from(s.opportunities).where(eq(s.opportunities.projectId, project.id)).orderBy(desc(s.opportunities.overallScore));
  const statusMatch = (o: (typeof all)[number]) => status === "all" || (status === "active" ? o.status !== "dismissed" : o.status === status);
  const inStatus = all.filter(statusMatch);
  const rows = inStatus.filter((o) => type === "ALL" || o.type === type);
  const counts = Object.fromEntries(TYPES.map((t) => [t, inStatus.filter((o) => t === "ALL" || o.type === t).length]));
  const qs = (t: string, st: string) => `/app/opportunities?type=${t}&status=${st}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Opportunities"
        description="Choose a next step from your collected market signals. Each recommendation shows why it matters, what you could do and the estimated spend."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>
              <span className="num text-ink-2">{all.filter((o) => o.status === "open").length}</span> open
            </span>
          </>
        }
        actions={
          <div className="inline-flex rounded-[7px] border border-line bg-surface p-0.5">
            {STATUSES.map((st) => (
              <Link key={st.key} href={qs(type, st.key)} className={cn("rounded-[5px] px-2.5 py-1 text-[12px] transition-colors", status === st.key ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink")}>
                {st.label}
              </Link>
            ))}
          </div>
        }
      />

      <LinkTabs param="type" tabs={TYPES.filter((t) => counts[t] > 0 || t === "ALL" || t === type).map((t) => ({ label: typeLabel(t), href: qs(t, status), value: t, count: counts[t] }))} />

      {rows.length ? (
        <OpportunityCards items={rows} />
      ) : (
        <EmptyState
          icon={<Lightbulb />}
          title={all.length ? "No opportunities match these filters" : "No opportunities yet"}
          description={all.length ? "Switch type or status to see the rest." : "Opportunities are derived from customers, creators and narratives once a scan has collected evidence."}
          action={
            all.length ? (
              <LinkButton href="/app/opportunities">Reset filters</LinkButton>
            ) : (
              <LinkButton href="/app/runs" variant="primary" icon={<Radar />}>
                Run a scan
              </LinkButton>
            )
          }
        />
      )}
    </div>
  );
}
