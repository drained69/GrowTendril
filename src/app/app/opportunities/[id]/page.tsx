import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or } from "drizzle-orm";
import { ArrowRight, Clock, FileSearch, FlaskConical, Gauge, ShieldCheck, Target, X, Zap } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { purchaseIntelAction } from "@/server/actions/agent";
import { createExperimentAction, dismissOpportunityAction } from "@/server/actions/growth";
import { COMMIT_THRESHOLD } from "@/server/domain/agent/information-value";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, Confidence, KeyValue, LinkButton, ModeBadge, PageHeader, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/features/agent/action-button";
import { EvidenceList } from "@/components/features/intel/evidence";
import { ScoreBreakdown, WhyNow } from "@/components/features/intel/score-breakdown";

const typeLabel = (t: string) => (t === "KOL" ? "Creator" : t === "PERSON" ? "Person asking" : t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " "));
const humanize = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^\w/, (c) => c.toUpperCase());

export default async function Opportunity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const [o] = await db.select().from(s.opportunities).where(and(eq(s.opportunities.id, id), eq(s.opportunities.projectId, project.id)));
  if (!o) notFound();
  const conds = [o.companyId ? eq(s.evidence.companyId, o.companyId) : undefined, o.kolId ? eq(s.evidence.kolId, o.kolId) : undefined, o.narrativeId ? eq(s.evidence.narrativeId, o.narrativeId) : undefined].filter((c) => c !== undefined);
  const [ev, exps] = await Promise.all([
    conds.length ? db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), or(...conds))).orderBy(desc(s.evidence.observedAt)).limit(12) : Promise.resolve([]),
    db.select().from(s.experiments).where(and(eq(s.experiments.opportunityId, o.id), eq(s.experiments.projectId, project.id))),
  ]);
  const subject = o.companyId ? { href: `/app/customers/${o.companyId}`, label: "Company" } : o.kolId ? { href: `/app/kols/${o.kolId}`, label: "Creator" } : o.narrativeId ? { href: `/app/narratives/${o.narrativeId}`, label: "Narrative" } : null;
  const scores = o.scores as Record<string, { score: number; reasons?: string[] } | undefined>;
  const components = Object.entries(scores)
    .filter(([, v]) => v && typeof v.score === "number")
    .map(([k, v]) => ({ key: k, label: humanize(k), score: v!.score, reasons: Array.isArray(v!.reasons) ? v!.reasons : [] }));
  const operate = can(role, "operate");
  const isIssue = o.type === "PRODUCT_ISSUE";
  const needsVerify = !isIssue && o.confidence < COMMIT_THRESHOLD && !!o.companyId;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Opportunities", href: "/app/opportunities" }]}
        title={
          <>
            <span className="num font-normal text-ink-4">#{o.number}</span>
            {o.title}
          </>
        }
        meta={
          <>
            <ModeBadge mode={o.dataMode} />
            <Badge tone={isIssue ? "bad" : o.type === "KOL" ? "accent" : o.type === "CUSTOMER" ? "info" : "neutral"}>
              {typeLabel(o.type)}
              {o.secondaryType ? ` + ${typeLabel(o.secondaryType)}` : ""}
            </Badge>
            <StatusBadge status={o.status} />
            <span>Updated {relTime(o.updatedAt)}</span>
          </>
        }
        actions={
          subject ? (
            <LinkButton href={subject.href} icon={<ArrowRight />}>
              {subject.label}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Why now" icon={<Clock />} />
            <CardBody>
              <WhyNow items={o.whyNow} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recommended experiment" icon={<Target />} />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink">{o.recommendedAction}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Evidence" icon={<FileSearch />} action={<Badge>{ev.length}</Badge>} />
            <CardBody>
              <EvidenceList items={ev} empty={subject ? "No evidence linked directly — see the subject page." : "No evidence linked to this opportunity yet."} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Act" icon={<Zap />} />
            <CardBody className="space-y-3">
              {isIssue && <Callout tone="warn">Routed to the product team. GrowTendril will not buy traffic into a growing friction point.</Callout>}
              {needsVerify && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    <ShieldCheck className="size-3.5" /> Below the {Math.round(COMMIT_THRESHOLD * 100)}% commit threshold — verify first.
                  </p>
                  {operate && <ActionButton action={purchaseIntelAction.bind(null, o.companyId!)} label="Evaluate data purchase" logTitle="Data purchase decision" className="w-full" />}
                </div>
              )}
              {!isIssue && o.status === "open" && operate && (
                <ActionButton action={createExperimentAction.bind(null, o.id)} label="Create experiment" variant="primary" icon={<FlaskConical />} className="w-full" logTitle="Experiment design" />
              )}
              {exps.length > 0 && (
                <ul className="divide-y divide-line rounded-[8px] border border-line">
                  {exps.map((x) => (
                    <li key={x.id}>
                      <Link href={`/app/experiments/${x.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                        <span className="truncate">
                          <span className="num mr-1.5 text-ink-4">EXP #{x.number}</span>
                          {x.title}
                        </span>
                        <StatusBadge status={x.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {o.status === "open" && operate && <ActionButton action={dismissOpportunityAction.bind(null, o.id)} label="Dismiss" variant="ghost" icon={<X />} className="w-full" confirm="Dismiss this opportunity? It will be hidden from the active list." />}
              {!operate && <p className="text-[12px] text-ink-3">Your role can view opportunities but not act on them.</p>}
              {operate && !isIssue && o.status !== "open" && exps.length === 0 && !needsVerify && <p className="text-[12px] text-ink-3">No actions available while the opportunity is {o.status}.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Decision inputs" icon={<Gauge />} action={<span className="num text-[20px] font-medium tracking-[-0.03em] text-ink">{o.overallScore}</span>} />
            <CardBody>
              <KeyValue
                items={[
                  { k: "Confidence", v: <Confidence value={o.confidence} /> },
                  { k: "Expected value", v: <span className="num">{o.expectedValue}</span> },
                  { k: "Estimated cost", v: <span className="num">{fmtUsdc(o.estimatedCostMicro)}</span> },
                  { k: "Commit threshold", v: <span className="num">{Math.round(COMMIT_THRESHOLD * 100)}%</span> },
                ]}
              />
            </CardBody>
          </Card>

          {components.length > 0 && (
            <Card>
              <CardHeader title="Score components" />
              <CardBody>
                <ScoreBreakdown components={components} />
              </CardBody>
              <CardFooter>Deterministic — the LLM never sets a score.</CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
