import Link from "next/link";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, Plug, Radar, Tags } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { classifySignals, SIGNAL_LABEL, termHits } from "@/server/domain/intel/signals";
import { analyzeMention } from "@/server/domain/intel/mentions";
import { listConnections, type ProviderConnection } from "@/server/integrations/vault";
import { relTime, DAY_MS } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, StatusDot } from "@/components/ui";
import { LinkTabs } from "@/components/ui/tabs";
import { RunScanButton } from "@/components/features/intel/run-scan-button";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "customers", label: "Customers" },
  { key: "kols", label: "Creators" },
  { key: "narratives", label: "Narratives" },
  { key: "competitors", label: "Competitors" },
  { key: "feedback", label: "Product feedback" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const CUSTOMER_SIGNALS = ["recommendation_request", "initiative", "hiring", "funding", "migration"];

function sourceState(c: ProviderConnection): { tone: "good" | "warn" | "idle" | "bad"; label: string } {
  if (c.source === "restricted") return { tone: "idle", label: "Restricted" };
  if (c.lastError) return { tone: "bad", label: "Error" };
  if (c.ready) return { tone: "good", label: c.source === "workspace" ? "Connected" : c.source === "platform" ? "Platform key" : "Keyless" };
  return { tone: "warn", label: "Needs key" };
}

export default async function Discover({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: raw = "all" } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === raw) ? (raw as FilterKey) : "all";
  const { project, role, db } = await requireProject();
  const pid = project.id;

  const since = new Date(Date.now() - 30 * DAY_MS);
  const [[profile], posts, [total], kolRows, narrRows, connections] = await Promise.all([
    db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, pid)),
    db.select().from(s.socialPosts).where(and(eq(s.socialPosts.projectId, pid), gte(s.socialPosts.publishedAt, since))).orderBy(desc(s.socialPosts.publishedAt)).limit(300),
    // The feed analyzes the newest 300; the header counts everything in the window.
    db.select({ n: count() }).from(s.socialPosts).where(and(eq(s.socialPosts.projectId, pid), gte(s.socialPosts.publishedAt, since))),
    db.select({ h: s.kols.handle }).from(s.kols).where(eq(s.kols.projectId, pid)),
    db.select({ id: s.narrativePosts.postId }).from(s.narrativePosts).innerJoin(s.narratives, eq(s.narrativePosts.narrativeId, s.narratives.id)).where(eq(s.narratives.projectId, pid)),
    listConnections(db, pid),
  ]);
  const kolHandles = new Set(kolRows.map((k) => k.h.toLowerCase()));
  const narrPostIds = new Set(narrRows.map((r) => r.id));
  const competitors = profile?.competitors ?? [];
  const keywords = [...(profile?.keywords ?? []), ...(profile?.terminology ?? [])];

  const rows = posts.map((p) => {
    const text = `${p.title ?? ""}\n${p.content}`;
    const signals = classifySignals(text, { competitors, provider: p.provider });
    const mentionsUs = termHits(text, [project.name]).length > 0;
    const comp = termHits(text, competitors);
    return { p, signals, topics: termHits(text, keywords), mentionsUs, comp, mention: mentionsUs ? analyzeMention(text, competitors) : null };
  });
  type R = (typeof rows)[number];
  const match = (r: R, f: FilterKey) => {
    switch (f) {
      case "customers":
        return r.p.entities.companies.length > 0 || r.signals.some((x) => CUSTOMER_SIGNALS.includes(x.type));
      case "kols":
        return kolHandles.has(r.p.authorHandle.toLowerCase());
      case "narratives":
        return narrPostIds.has(r.p.id);
      case "competitors":
        return r.comp.length > 0;
      case "feedback":
        return r.mentionsUs;
      default:
        return r.topics.length > 0 || r.mentionsUs;
    }
  };
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => match(r, f.key)).length])) as Record<FilterKey, number>;
  const filtered = rows.filter((r) => match(r, filter));

  const usable = connections.filter((c) => c.ready);
  const missing = connections.filter((c) => !c.ready && c.source !== "restricted");
  const demo = project.dataMode === "DEMO";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Discover"
        description="Research feed from legitimately accessible public sources. Every item links to its source; signals are classified by auditable rules."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>
              <span className="num text-ink-2">{total?.n ?? posts.length}</span> posts in the last 30 days
              {(total?.n ?? 0) > posts.length && <span className="text-ink-4"> (newest {posts.length} analyzed)</span>}
            </span>
            <span className="text-ink-4">·</span>
            <span>
              <span className="num text-ink-2">{usable.length}</span> of {connections.length} sources ready
            </span>
          </>
        }
        actions={
          <>
            <LinkButton href="/app/integrations" icon={<Plug />}>
              Sources
            </LinkButton>
            {can(role, "operate") && <RunScanButton canOperate />}
          </>
        }
      />

      <Card>
        <CardHeader
          title="Source status"
          description={missing.length ? `${missing.length} source${missing.length === 1 ? "" : "s"} need credentials before they can contribute` : "Every available source is ready"}
          icon={<Plug />}
          action={
            <Link href="/app/integrations" className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
              Manage <ArrowRight className="size-3" />
            </Link>
          }
        />
        <CardBody className="flex flex-wrap gap-2">
          {connections.map((c) => {
            const st = sourceState(c);
            return (
              <Link
                key={c.provider.id}
                href="/app/integrations"
                title={c.provider.restrictedReason ?? c.lastError ?? c.provider.description}
                className="inline-flex h-7 items-center gap-2 rounded-[6px] border border-line bg-surface-2/50 px-2.5 text-[12px] transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <StatusDot tone={st.tone} />
                <span className={c.ready ? "font-medium text-ink" : "text-ink-3"}>{c.provider.name}</span>
                <span className="text-[11px] text-ink-4">{st.label}</span>
              </Link>
            );
          })}
        </CardBody>
      </Card>

      {demo && <Callout tone="info">This DEMO project analyzes a seeded fictional corpus. Live providers are used by non-demo workspaces.</Callout>}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <LinkTabs param="filter" className="mb-3" tabs={FILTERS.map((f) => ({ label: f.label, href: `/app/discover?filter=${f.key}`, value: f.key, count: counts[f.key] }))} />
          {filtered.length ? (
            <ul className="space-y-2">
              {filtered.slice(0, 120).map(({ p, signals, topics, mention, comp }) => {
                const external = p.url.startsWith("http");
                return (
                  <li key={p.id} className="rounded-[10px] border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                      <span className="num font-medium uppercase text-ink-2">{p.provider}</span>
                      <span className="text-ink-4">·</span>
                      <span className="text-ink-2">@{p.authorHandle}</span>
                      {p.authorFollowers ? <span className="num text-ink-4">{p.authorFollowers.toLocaleString()} followers</span> : null}
                      {p.entities.companies[0] && <Badge tone="info">{p.entities.companies[0]}</Badge>}
                      <span className="text-ink-4">·</span>
                      <time dateTime={p.publishedAt.toISOString()} title={p.publishedAt.toISOString()}>
                        {relTime(p.publishedAt)}
                      </time>
                      <span className="ml-auto">
                        <ModeBadge mode={p.dataMode} />
                      </span>
                    </div>
                    {p.title && <div className="mt-1.5 text-[13px] font-medium text-ink">{p.title}</div>}
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                      {p.content.slice(0, 360)}
                      {p.content.length > 360 ? "…" : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {signals
                        .filter((x) => x.type !== "mention")
                        .slice(0, 3)
                        .map((x) => (
                          <Badge key={x.type} tone="accent">
                            {SIGNAL_LABEL[x.type]}
                          </Badge>
                        ))}
                      {topics.slice(0, 4).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                      {comp.map((c) => (
                        <Badge key={c} tone="warn">
                          vs {c}
                        </Badge>
                      ))}
                      {mention && (
                        <Badge tone={mention.sentiment === "negative" ? "bad" : mention.sentiment === "positive" ? "good" : "neutral"}>
                          {mention.sentiment} · {mention.categories.slice(0, 2).join(", ").replace(/_/g, " ") || "mention"}
                        </Badge>
                      )}
                      <a href={p.url} target={external ? "_blank" : undefined} rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-[11.5px] text-s1 hover:underline">
                        Source {external && <ArrowUpRight className="size-3" />}
                      </a>
                    </div>
                  </li>
                );
              })}
              {filtered.length > 120 && <li className="px-1 text-[11.5px] text-ink-3">Showing the 120 most recent of {filtered.length} matching items.</li>}
            </ul>
          ) : (
            <EmptyState
              icon={<Radar />}
              title={posts.length ? "Nothing matches this filter" : "No market data collected yet"}
              description={
                posts.length
                  ? "Try another filter, or widen the search terms in the product profile."
                  : usable.length
                    ? "Run a scan to collect public posts from the ready sources."
                    : "Connect at least one market source, then run a scan."
              }
              action={posts.length ? <LinkButton href="/app/discover">Show all</LinkButton> : usable.length ? <RunScanButton canOperate={can(role, "operate")} /> : <LinkButton href="/app/integrations" variant="primary">Connect sources</LinkButton>}
            />
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Search terms" icon={<Tags />} />
            <CardBody>
              {profile?.keywords.length ? (
                <div className="flex flex-wrap gap-1">
                  {profile.keywords.map((k) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-3">No keywords yet. Add them to the product profile so scans know what to look for.</p>
              )}
              {competitors.length > 0 && (
                <>
                  <div className="label mb-1.5 mt-4">Competitors tracked</div>
                  <div className="flex flex-wrap gap-1">
                    {competitors.map((c) => (
                      <Badge key={c} tone="warn">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
              <Link href="/app/settings" className="mt-4 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                Edit product profile <ArrowRight className="size-3" />
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
