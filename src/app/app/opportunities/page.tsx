import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Lightbulb, Radar } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { fmtUsdc } from "@/lib/money";
import { Badge, Confidence, EmptyState, LinkButton, ModeBadge, PageHeader, StatusBadge, cn, type Tone } from "@/components/ui";
import { LinkTabs } from "@/components/ui/tabs";

const TYPES = ["ALL", "CUSTOMER", "KOL", "NARRATIVE", "PERSON", "PRODUCT_ISSUE", "COMPETITOR", "PARTNERSHIP", "CONTENT", "COMMUNITY", "EVENT"];
const TYPE_LABEL: Record<string, string> = { ALL: "All", KOL: "Creator", PERSON: "Person asking", PRODUCT_ISSUE: "Product issue" };
const STATUSES = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "dismissed", label: "Dismissed" },
];
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");
const typeTone = (t: string): Tone => (t === "PRODUCT_ISSUE" ? "bad" : t === "KOL" ? "accent" : t === "CUSTOMER" ? "info" : "neutral");

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
        description="Everything GrowTendril found, prioritized. Each one answers: why this, why now, what evidence, what to do, and what it is worth spending."
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
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((o) => (
            <Link key={o.id} href={`/app/opportunities/${o.id}`} className="group flex flex-col rounded-[10px] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/40">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="num text-ink-4">#{o.number}</span>
                <Badge tone={typeTone(o.type)}>
                  {typeLabel(o.type)}
                  {o.secondaryType ? ` + ${typeLabel(o.secondaryType)}` : ""}
                </Badge>
                <span className="ml-auto flex items-center gap-1.5">
                  {o.status !== "open" && <StatusBadge status={o.status} />}
                  <ModeBadge mode={o.dataMode} />
                </span>
              </div>
              <div className="mt-2 text-[13.5px] font-medium leading-snug text-ink">{o.title}</div>
              <ul className="mb-3 mt-1.5 flex-1 space-y-1 text-[12px] leading-snug text-ink-2">
                {o.whyNow.slice(0, 2).map((w, iw) => (
                  <li key={`${iw}:${w}`} className="flex gap-2">
                    <span className="mt-[6px] size-1 shrink-0 rounded-full bg-ink-4" />
                    <span className="line-clamp-1">{w}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
                <Confidence value={o.confidence} />
                <span className="num flex items-center gap-3 text-[11.5px] text-ink-3">
                  <span>EV {o.expectedValue}</span>
                  <span>est. {fmtUsdc(o.estimatedCostMicro)}</span>
                  <span className="text-ink">score {o.overallScore}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
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
