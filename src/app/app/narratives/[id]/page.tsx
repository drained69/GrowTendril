import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Activity, BarChart3, Building2, FileSearch, Swords, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { schema as s } from "@/server/db/client";
import { termHits } from "@/server/domain/intel/signals";
import { DAY_MS } from "@/lib/time";
import { Avatar, Badge, Card, CardBody, CardHeader, KeyValue, ModeBadge, PageHeader, Velocity, type Tone } from "@/components/ui";
import { Columns } from "@/components/charts";
import { EvidenceList } from "@/components/features/intel/evidence";

const STATUS_TONE: Record<string, Tone> = { EMERGING: "accent", ACCELERATING: "good", PEAKING: "warn", DECLINING: "bad", CONTROVERSIAL: "warn", UNDEREXPLORED: "info", STABLE: "neutral" };

export default async function Narrative({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, db } = await requireProject();
  const [n] = await db.select().from(s.narratives).where(and(eq(s.narratives.id, id), eq(s.narratives.projectId, project.id)));
  if (!n) notFound();
  const [[profile], postRows, ev, voiceRows, companyRows] = await Promise.all([
    db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, project.id)),
    db.select({ p: s.socialPosts }).from(s.narrativePosts).innerJoin(s.socialPosts, eq(s.narrativePosts.postId, s.socialPosts.id)).where(eq(s.narrativePosts.narrativeId, n.id)),
    db.select().from(s.evidence).where(eq(s.evidence.narrativeId, n.id)).orderBy(desc(s.evidence.observedAt)),
    db.select({ k: s.kols }).from(s.narrativeKols).innerJoin(s.kols, eq(s.narrativeKols.kolId, s.kols.id)).where(eq(s.narrativeKols.narrativeId, n.id)),
    db.select({ c: s.companies }).from(s.narrativeCompanies).innerJoin(s.companies, eq(s.narrativeCompanies.companyId, s.companies.id)).where(eq(s.narrativeCompanies.narrativeId, n.id)),
  ]);
  const posts = postRows.map((r) => r.p);
  const voices = voiceRows.map((r) => r.k).sort((a, b) => b.overallScore - a.overallScore);
  const companies = companyRows.map((r) => r.c).sort((a, b) => b.intentScore - a.intentScore);
  const competitors = [...new Set(posts.flatMap((p) => termHits(p.content, profile?.competitors ?? [])))];
  const daily = Array.from({ length: 14 }, (_, i) => posts.filter((p) => Math.floor((Date.now() - p.publishedAt.getTime()) / DAY_MS) === 13 - i).length);
  const authors = new Set(posts.map((p) => p.authorHandle));

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Narratives", href: "/app/narratives" }]}
        title={
          <>
            {n.label}
            <Badge tone={STATUS_TONE[n.status]}>{n.status.charAt(0) + n.status.slice(1).toLowerCase()}</Badge>
          </>
        }
        description={n.summary ?? undefined}
        meta={
          <>
            <ModeBadge mode={n.dataMode} />
            <Velocity pct={n.velocityPct} />
            <span>week over week</span>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Volume · last 14 days" description="Posts per day; the current week is highlighted." icon={<BarChart3 />} action={<span className="num text-[12px] text-ink-3">{posts.length} posts</span>} />
            <CardBody>
              <Columns values={daily} highlightFrom={7} height={84} labels={daily.map((_, i) => `${13 - i}d ago`)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Representative evidence" icon={<FileSearch />} action={<Badge>{ev.length}</Badge>} />
            <CardBody>
              <EvidenceList items={ev} empty="No evidence has been attached to this narrative yet. It is added as scans classify matching posts." />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Signal" icon={<Activity />} />
            <CardBody>
              <KeyValue
                items={[
                  { k: "Volume (7d)", v: <span className="num">{n.volume7d}</span> },
                  { k: "Prior 7d", v: <span className="num">{n.volumePrev7d}</span> },
                  { k: "Velocity", v: <Velocity pct={n.velocityPct} /> },
                  { k: "Relevance to us", v: <span className="num">{n.relevance}/100</span> },
                  { k: "Controversy", v: <span className="num">{Math.round(n.controversy * 100)}%</span> },
                  { k: "Distinct voices", v: <span className="num">{authors.size}</span> },
                ]}
              />
              {n.terms.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
                  {n.terms.map((t, it) => (
                    <Badge key={`${it}:${t}`}>{t}</Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Important voices" icon={<Users />} />
            {voices.length ? (
              <ul className="divide-y divide-line">
                {voices.map((k) => (
                  <li key={k.id}>
                    <Link href={`/app/kols/${k.id}`} className="flex items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                      <Avatar name={k.handle} size={20} />
                      <span className="min-w-0 flex-1 truncate">
                        @{k.handle} <span className="text-ink-3">· {k.provider}</span>
                      </span>
                      <span className="num text-ink-2">{k.overallScore}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">No dominant voice yet — room to lead this conversation.</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Related companies" description="Potential customers discussing this theme" icon={<Building2 />} />
            {companies.length ? (
              <ul className="divide-y divide-line">
                {companies.map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/customers/${c.id}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                      <span className="truncate">{c.name}</span>
                      <span className="num text-[11.5px] text-ink-3">intent {c.intentScore}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">None yet. Companies link here when their posts fall into this narrative.</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Competitors involved" icon={<Swords />} />
            <CardBody>
              {competitors.length ? (
                <div className="flex flex-wrap gap-1">
                  {competitors.map((c) => (
                    <Badge key={c} tone="warn">
                      {c}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-3">No tracked competitor is mentioned in this narrative.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
