import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight, Clock, FileSearch, Gauge, ShieldCheck, Target } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { purchaseIntelAction } from "@/server/actions/agent";
import { COMPANY_WEIGHTS, type ScoreComponent } from "@/server/domain/scoring/intent";
import { COMMIT_THRESHOLD } from "@/server/domain/agent/information-value";
import { relTime } from "@/lib/time";
import { Badge, Card, CardBody, CardFooter, CardHeader, Confidence, KeyValue, LinkButton, ModeBadge, PageHeader, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/features/agent/action-button";
import { EvidenceList } from "@/components/features/intel/evidence";
import { ScoreBreakdown, WhyNow } from "@/components/features/intel/score-breakdown";

const LABEL: Record<string, string> = { productFit: "Product fit", timing: "Timing", buyingIntent: "Buying intent", evidenceQuality: "Evidence quality", engagementOpportunity: "Engagement opportunity" };

export default async function Company({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const [c] = await db.select().from(s.companies).where(and(eq(s.companies.id, id), eq(s.companies.projectId, project.id)));
  if (!c) notFound();
  const [ev, [opp]] = await Promise.all([
    db.select().from(s.evidence).where(and(eq(s.evidence.companyId, c.id), eq(s.evidence.projectId, project.id))).orderBy(desc(s.evidence.observedAt)),
    db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, project.id), eq(s.opportunities.subjectKey, `company:${c.id}`))),
  ]);
  const scores = c.scores as Record<string, ScoreComponent>;
  const purchases = ev.filter((e) => e.classifiedBy === "x402");
  const components = Object.entries(COMPANY_WEIGHTS)
    .filter(([k]) => scores[k])
    .map(([k, w]) => ({ key: k, label: LABEL[k] ?? k, weight: w, score: scores[k].score, reasons: scores[k].reasons }));
  const belowThreshold = c.confidence < COMMIT_THRESHOLD;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Customers", href: "/app/customers" }]}
        title={
          <>
            {c.name}
            <StatusBadge status={c.status} />
          </>
        }
        description={c.whyFit ?? undefined}
        meta={
          <>
            <ModeBadge mode={c.dataMode} />
            <span>Updated {relTime(c.updatedAt)}</span>
            <span className="text-ink-4">·</span>
            <span>
              <span className="num text-ink-2">{ev.length}</span> evidence items
            </span>
          </>
        }
        actions={
          opp ? (
            <LinkButton href={`/app/opportunities/${opp.id}`} icon={<ArrowRight />}>
              Opportunity #{opp.number}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Why now" icon={<Clock />} />
            <CardBody>
              <WhyNow items={c.whyNow} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Evidence" description="Every claim traced to a public source or a paid x402 lookup." icon={<FileSearch />} action={purchases.length ? <Badge tone="info">{purchases.length} verified via x402</Badge> : <Badge>{ev.length}</Badge>} />
            <CardBody>
              <EvidenceList items={ev} empty="No evidence attached yet. Evidence lands here as scans or data purchases reference this company." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recommended action" icon={<Target />} />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink">{c.recommendedAction}</p>
            </CardBody>
            <CardFooter>GrowTendril prepares the approach; a human decides whether and how to contact them. No automated emails, DMs, mentions or comments — ever.</CardFooter>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Opportunity score" icon={<Gauge />} action={<span className="num text-[20px] font-medium tracking-[-0.03em] text-ink">{c.overallScore}</span>} />
            <CardBody>
              <div className="mb-4 grid grid-cols-2 gap-3 text-[12px]">
                <div className="rounded-[8px] border border-line px-3 py-2">
                  <div className="text-ink-3">Intent</div>
                  <div className="num mt-0.5 text-[16px] text-ink">{c.intentScore}</div>
                </div>
                <div className="rounded-[8px] border border-line px-3 py-2">
                  <div className="text-ink-3">Fit</div>
                  <div className="num mt-0.5 text-[16px] text-ink">{c.fitScore}</div>
                </div>
              </div>
              {components.length ? (
                <ScoreBreakdown components={components} footnote="Overall = Σ component × weight. Deterministic — the LLM never sets a score." />
              ) : (
                <p className="text-[12.5px] text-ink-3">No component scores recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Verify before spending" icon={<ShieldCheck />} />
            <CardBody className="space-y-4">
              <KeyValue
                items={[
                  { k: "Confidence", v: <Confidence value={c.confidence} /> },
                  { k: "Commit threshold", v: <span className="num">{Math.round(COMMIT_THRESHOLD * 100)}%</span> },
                  { k: "Signals purchased", v: <span className="num">{purchases.length}</span> },
                ]}
              />
              {can(role, "operate") ? (
                <ActionButton action={purchaseIntelAction.bind(null, c.id)} label="Should GrowTendril buy more data?" variant={belowThreshold ? "primary" : "secondary"} logTitle="Data purchase decision" className="w-full" />
              ) : (
                <p className="text-[12px] text-ink-3">Your role can view this company but not buy data. Ask an operator or admin.</p>
              )}
            </CardBody>
            <CardFooter>
              <span>Finds an x402 service, quotes it, computes the expected value of information, applies policy, and pays via Circle Gateway only if it is worth it.</span>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
