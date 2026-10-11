import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight, Clock, FileSearch, FileText, FlaskConical, Gauge, UserRound } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import type { ScoreComponent } from "@/server/domain/scoring/intent";
import { KOL_WEIGHTS } from "@/server/domain/scoring/kol";
import { estimateKolCostMicro } from "@/server/domain/intel/analyze";
import { fmtUsdc } from "@/lib/money";
import { Avatar, Badge, Card, CardBody, CardHeader, ExternalLink, KeyValue, LinkButton, ModeBadge, PageHeader, StatusBadge } from "@/components/ui";
import { EvidenceList } from "@/components/features/intel/evidence";
import { ScoreBreakdown, WhyNow } from "@/components/features/intel/score-breakdown";
import { PayoutForm } from "@/components/features/creators/payout-form";

const LABEL: Record<string, string> = { audienceFit: "Audience fit", topicAuthority: "Topic authority", recentRelevance: "Recent relevance", engagementQuality: "Engagement quality", narrativeFit: "Narrative fit", historicalProductFit: "Historical product fit", authenticity: "Authenticity signals", campaignFit: "Estimated campaign fit" };

export default async function Creator({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const [k] = await db.select().from(s.kols).where(and(eq(s.kols.id, id), eq(s.kols.projectId, project.id)));
  if (!k) notFound();
  const m = k.metrics as Record<string, ScoreComponent>;
  const [ev, camps, [opp]] = await Promise.all([
    db.select().from(s.evidence).where(eq(s.evidence.kolId, k.id)).orderBy(desc(s.evidence.observedAt)),
    db.select({ c: s.campaigns, x: s.experiments }).from(s.campaigns).innerJoin(s.experiments, eq(s.campaigns.experimentId, s.experiments.id)).where(and(eq(s.campaigns.kolId, k.id), eq(s.experiments.projectId, project.id))),
    db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, project.id), eq(s.opportunities.subjectKey, `kol:${k.id}`))),
  ]);
  const weights = KOL_WEIGHTS as Record<string, number>;
  const components = Object.keys(LABEL)
    .filter((key) => m[key])
    .map((key) => ({ key, label: LABEL[key], weight: weights[key], score: m[key].score, reasons: m[key].reasons }));
  const latest = camps.at(-1);
  const briefHref = `/app/kols/${k.id}/brief${latest ? `?experiment=${latest.x.id}` : ""}`;
  const external = !!k.url?.startsWith("http");

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Creators", href: "/app/kols" }]}
        title={
          <>
            <Avatar name={k.handle} size={26} />@{k.handle}
            <span className="text-[13px] font-normal text-ink-3">{k.provider}</span>
            {k.status !== "candidate" && <StatusBadge status={k.status} />}
          </>
        }
        description={k.recommendedAngle ? `Recommended angle: ${k.recommendedAngle}` : undefined}
        meta={
          <>
            <ModeBadge mode={k.dataMode} />
            <span>
              <span className="num text-ink-2">{k.followers?.toLocaleString() ?? "—"}</span> followers
            </span>
            <span className="text-ink-4">·</span>
            <span>
              score <span className="num text-ink-2">{k.overallScore}</span>
            </span>
          </>
        }
        actions={
          <>
            {opp && (
              <LinkButton href={`/app/opportunities/${opp.id}`} icon={<ArrowRight />}>
                Opportunity #{opp.number}
              </LinkButton>
            )}
            <LinkButton href={briefHref} variant="primary" icon={<FileText />}>
              Creator brief
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Why now" icon={<Clock />} />
            <CardBody>
              <WhyNow items={k.whyNow} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Evidence" description="Posts and signals that put this creator on the list." icon={<FileSearch />} action={<Badge>{ev.length}</Badge>} />
            <CardBody>
              <EvidenceList items={ev} empty="No evidence attached yet. It is added as scans attribute relevant posts to this creator." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Campaign history" icon={<FlaskConical />} />
            {camps.length ? (
              <ul className="divide-y divide-line">
                {camps.map(({ c, x }) => (
                  <li key={c.id}>
                    <Link href={`/app/experiments/${x.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px] transition-colors hover:bg-surface-2">
                      <span className="min-w-0 truncate">
                        <span className="num mr-2 text-ink-4">EXP #{x.number}</span>
                        {x.title}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <ModeBadge mode={x.dataMode} />
                        <StatusBadge status={x.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">No campaigns yet. Create an experiment from this creator’s opportunity to brief and pay them.</CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Creator score" icon={<Gauge />} action={<span className="num text-[20px] font-medium tracking-[-0.03em] text-ink">{k.overallScore}</span>} />
            <CardBody>
              {components.length ? <ScoreBreakdown components={components} footnote="Weighted, deterministic components. Followers only enter log-damped." /> : <p className="text-[12.5px] text-ink-3">No component scores recorded yet.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Profile & payout" icon={<UserRound />} />
            <CardBody className="space-y-4">
              <KeyValue
                items={[
                  { k: "Followers", v: <span className="num">{k.followers?.toLocaleString() ?? "unknown"}</span> },
                  { k: "Estimated campaign cost", v: <span className="num">{fmtUsdc(estimateKolCostMicro(k.followers))} <span className="text-ink-3">est.</span></span> },
                  ...(k.url && external ? [{ k: "Profile", v: <ExternalLink href={k.url}>Open</ExternalLink> }] : []),
                ]}
              />
              <div className="border-t border-line pt-4">
                <PayoutForm kolId={k.id} current={k.payoutAddress} disabled={!can(role, "manage_wallet")} />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
