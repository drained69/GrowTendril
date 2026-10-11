import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ArrowRight, Beaker, CreditCard, FileText, Gauge, Link2, Play, Rocket, Search } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { experimentPayee, trancheState } from "@/server/domain/growth/experiments";
import { buildUtmUrl, EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { launchExperimentAction } from "@/server/actions/growth";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Card, CardBody, CardFooter, CardHeader, ExternalLink, KeyValue, LinkButton, ModeBadge, PageHeader, Progress, Stat, StatusBadge, Table, TxStateBadge, shortHash } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { EvidenceList } from "@/components/features/intel/evidence";
import { ActionButton } from "@/components/features/agent/action-button";

const RAIL: Record<string, string> = { gateway_x402: "x402 · Gateway", app_kit_send: "App Kit Send", app_kit_bridge: "App Kit Bridge", gateway_deposit: "Gateway deposit" };

export default async function Experiment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, id), eq(s.experiments.projectId, project.id)));
  if (!x) notFound();
  const [[camp], ts, payee, [mission], txs, funnel, ev] = await Promise.all([
    db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, x.id)),
    trancheState(db, x),
    experimentPayee(db, x),
    db.select({ goalEvent: s.missions.goalEvent }).from(s.missions).where(eq(s.missions.id, x.missionId)),
    db.select().from(s.transactions).where(and(eq(s.transactions.experimentId, x.id), eq(s.transactions.projectId, project.id))).orderBy(desc(s.transactions.createdAt)),
    db
      .select({ type: s.conversionEvents.eventType, n: sql<number>`count(distinct coalesce(${s.conversionEvents.visitorId}, ${s.conversionEvents.id}))::int` })
      .from(s.attribution)
      .innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id))
      .where(eq(s.attribution.experimentId, x.id))
      .groupBy(s.conversionEvents.eventType),
    x.evidenceIds.length ? db.select().from(s.evidence).where(and(inArray(s.evidence.id, x.evidenceIds), eq(s.evidence.projectId, project.id))) : Promise.resolve([]),
  ]);
  // Same measurement as the experiments list and the learning engine: committed spend from the ledger,
  // distinct visitors who completed the mission's goal event via this experiment's referral code.
  const goalEvent = mission?.goalEvent ?? x.successEvent;
  const spent = ts.perf?.spentMicro ?? 0;
  const conv = ts.perf?.conversions ?? 0;
  const cpa = ts.cpaMicro;
  const link = camp ? buildUtmUrl(camp.destinationUrl, { source: camp.utmSource, medium: camp.utmMedium, campaign: camp.utmCampaign, ref: camp.referralCode }) : null;
  const operate = can(role, "operate");
  const overStop = spent >= x.stopAfterSpendMicro && ts.stopHit;
  const canLaunch = operate && x.status === "proposed" && !!payee.recipient;
  const canSecond = operate && ts.canReleaseSecond;
  const outcome = x.outcome as { reason?: string; verdict?: string } | null;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[
          { label: "Experiments", href: "/app/experiments" },
          { label: `#${x.number}`, href: `/app/experiments/${x.id}` },
        ]}
        title={
          <>
            <span className="num font-normal text-ink-4">#{x.number}</span> {x.title}
          </>
        }
        description={x.hypothesis}
        meta={
          <>
            <ModeBadge mode={x.dataMode} />
            <StatusBadge status={x.status} />
            <Badge tone="muted">{x.channel}</Badge>
            <span>Created {relTime(x.createdAt)}</span>
          </>
        }
        actions={
          <>
            {camp?.kolId && (
              <LinkButton href={`/app/kols/${camp.kolId}/brief?experiment=${x.id}`} icon={<FileText />}>
                Creator brief
              </LinkButton>
            )}
            {canLaunch && <ActionButton action={launchExperimentAction.bind(null, x.id, "first")} label="Launch — pay first tranche" icon={<Rocket />} variant="primary" logTitle="Launch experiment" />}
            {canSecond && <ActionButton action={launchExperimentAction.bind(null, x.id, "second")} label="Release second tranche" icon={<Play />} logTitle="Second tranche" />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Measured result" description="Spend from the ledger; conversions from attribution" icon={<Gauge />} action={outcome?.verdict ? <Badge tone={outcome.verdict === "SCALE" ? "good" : outcome.verdict === "STOP" || outcome.verdict === "REDUCE" ? "bad" : "neutral"}>{outcome.verdict}</Badge> : undefined} />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Spent" value={fmtUsdc(spent, { unit: false })} sub={`committed, of ${fmtUsdc(x.budgetMicro, { unit: false })} USDC`} />
                <Stat label="Conversions" value={conv} sub={`${EVENT_LABEL[goalEvent as ConversionEventType] ?? goalEvent} · unique`} />
                <Stat label="CPA" value={cpa != null ? fmtUsdc(cpa, { unit: false }) : "—"} sub={`stop above ${fmtUsdc(x.stopMaxCpaMicro, { unit: false })}`} tone={overStop ? "bad" : undefined} />
                <Stat label="vs target" value={`${conv}/${x.successTarget}`} sub={`${Math.round((conv / Math.max(1, x.successTarget)) * 100)}% of goal`} tone={conv >= x.successTarget ? "good" : undefined} />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-[11.5px] text-ink-3">
                  <span>Budget used</span>
                  <span className="num">{Math.round((spent / Math.max(1, x.budgetMicro)) * 100)}%</span>
                </div>
                <Progress value={spent} max={x.budgetMicro} marker={x.stopAfterSpendMicro} />
                <div className="mt-1 text-[11px] text-ink-4">Marker: stop condition is evaluated after {fmtUsdc(x.stopAfterSpendMicro)}</div>
              </div>
              {funnel.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {funnel.map((f) => (
                    <Badge key={f.type} tone={f.type === goalEvent ? "info" : "neutral"}>
                      {EVENT_LABEL[f.type as ConversionEventType] ?? f.type} <span className="num">{f.n}</span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-ink-3">No attributed events yet — they arrive through the tracked link or the conversion webhook with this campaign’s referral code.</p>
              )}
              {outcome?.reason && (
                <p className="rounded-[8px] border border-line bg-bg/50 px-3 py-2 text-[12.5px] text-ink-2">
                  <span className="label mr-2">Learning</span>
                  {outcome.reason}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Design" icon={<Beaker />} />
            <CardBody>
              <KeyValue
                items={[
                  { k: "Hypothesis", v: <span className="block max-w-xl text-left">{x.hypothesis}</span> },
                  { k: "Target", v: x.target },
                  { k: "Action", v: <span className="block max-w-xl text-left">{x.action}</span> },
                  { k: "Budget", v: <span className="num">{fmtUsdc(x.budgetMicro)} <span className="text-ink-3">· {x.budgetCategory}</span></span> },
                  { k: "Timeframe", v: `${x.timeframeDays} days` },
                  { k: "Success metric", v: `${x.successTarget} × ${EVENT_LABEL[x.successEvent as ConversionEventType] ?? x.successEvent}` },
                  { k: "Stop condition", v: <span className="num">CPA &gt; {fmtUsdc(x.stopMaxCpaMicro)} after {fmtUsdc(x.stopAfterSpendMicro)}</span> },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments" description="Every tranche goes through Zod → policy engine → (approval) → App Kit" icon={<CreditCard />} />
            {txs.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Tranche</th>
                    <th>Rail</th>
                    <th className="text-right">Amount</th>
                    <th>State</th>
                    <th>Reference</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td className="num text-ink-3">{t.id === ts.first?.id ? "1" : t.id === ts.second?.id ? "2" : "—"}</td>
                      <td className="whitespace-nowrap">{RAIL[t.rail] ?? t.rail}</td>
                      <td className="num text-right">{fmtUsdc(t.amountMicro)}</td>
                      <td>
                        <span className="flex items-center gap-1">
                          <TxStateBadge state={t.state} />
                          {t.dataMode !== t.state && <ModeBadge mode={t.dataMode} />}
                        </span>
                      </td>
                      <td className="text-[11.5px]">
                        {t.txHash ? (
                          <ExternalLink href={t.explorerUrl ?? txExplorerUrl(t.chain, t.txHash)} className="num">
                            {shortHash(t.txHash, 4)}
                          </ExternalLink>
                        ) : t.error ? (
                          <span className="block max-w-[200px] truncate text-critical" title={t.error}>
                            {t.error}
                          </span>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-ink-3">{relTime(t.createdAt)}</td>
                      <td className="text-right">
                        <Link href={`/app/receipts/${t.decisionId}`} className="text-[11.5px] text-ink-3 hover:text-ink">
                          Receipt →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">{x.status === "proposed" ? "No payments yet — launching pays the first tranche." : "No payments recorded for this experiment."}</CardBody>
            )}
          </Card>

          {ev.length > 0 && (
            <Card>
              <CardHeader title="Evidence behind this experiment" description={`${ev.length} source${ev.length === 1 ? "" : "s"}`} icon={<Search />} />
              <CardBody>
                <EvidenceList items={ev} />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Attribution" description="How conversions are tied back to this experiment" icon={<Link2 />} />
            {camp ? (
              <>
                <CardBody className="space-y-4">
                  <KeyValue
                    items={[
                      { k: "Referral code", v: <span className="num">{camp.referralCode}</span> },
                      { k: "utm_source", v: <span className="num">{camp.utmSource}</span> },
                      { k: "utm_medium", v: <span className="num">{camp.utmMedium}</span> },
                      { k: "utm_campaign", v: <span className="num">{camp.utmCampaign}</span> },
                      { k: "Campaign ID", v: <span className="num text-[11.5px]">{camp.id.slice(0, 8)}</span> },
                      { k: "Experiment ID", v: <span className="num text-[11.5px]">{x.id.slice(0, 8)}</span> },
                    ]}
                  />
                  <div>
                    <div className="label mb-1.5">Tracked short link · records a visit</div>
                    <CopyField value={`/r/${camp.referralCode}`} />
                  </div>
                  {link && (
                    <div>
                      <div className="label mb-1.5">Destination with UTM</div>
                      <CopyField value={link} />
                    </div>
                  )}
                </CardBody>
                {camp.kolId && (
                  <CardFooter>
                    <span>Creator campaign</span>
                    <Link href={`/app/kols/${camp.kolId}`} className="inline-flex items-center gap-1 hover:text-ink">
                      Creator <ArrowRight className="size-3" />
                    </Link>
                  </CardFooter>
                )}
              </>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">No campaign yet. One is created with a referral code when the experiment launches.</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Run" icon={<Rocket />} />
            <CardBody className="space-y-3">
              {x.status === "proposed" || x.status === "running" ? (
                <KeyValue
                  items={[
                    { k: "Payee", v: payee.recipient ? <span className="num break-all text-[11.5px]">{payee.recipient}{payee.placeholder ? " (DEMO placeholder — simulated)" : ""}</span> : <span className="text-critical">none</span> },
                    { k: "Tranche 1", v: ts.first ? <TxStateBadge state={ts.first.state} /> : <span className="num">{fmtUsdc(x.stopAfterSpendMicro)}</span> },
                    { k: "Tranche 2", v: ts.second ? <TxStateBadge state={ts.second.state} /> : <span className="num">{fmtUsdc(ts.secondAmountMicro)}</span> },
                  ]}
                />
              ) : null}
              {!operate ? (
                <p className="text-[12.5px] text-ink-3">Viewers can’t launch experiments.</p>
              ) : x.status === "proposed" ? (
                canLaunch ? (
                  <ActionButton action={launchExperimentAction.bind(null, x.id, "first")} label="Launch — pay first tranche" icon={<Rocket />} variant="primary" logTitle="Launch experiment" className="w-full" />
                ) : (
                  <p className="text-[12.5px] text-critical">{payee.reason}</p>
                )
              ) : canSecond ? (
                <ActionButton action={launchExperimentAction.bind(null, x.id, "second")} label="Release second tranche" icon={<Play />} logTitle="Second tranche" className="w-full" />
              ) : (
                <p className="text-[12.5px] text-ink-3">{x.status === "running" ? ts.secondBlockedReason : `Nothing to run — the experiment is ${x.status.replace(/_/g, " ")}.`}</p>
              )}
              <p className="text-[11.5px] leading-relaxed text-ink-3">Payments go through Zod → policy engine → (approval) → App Kit. Tranche 1 is the amount at risk before the stop condition is evaluated; tranche 2 is released only if it is not hit, and each tranche can be paid once.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
