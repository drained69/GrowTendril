import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, Beaker, CircleStop, ClipboardPen, CreditCard, FileText, Gauge, Hand, Link2, PackageCheck, Play, Rocket, Search } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { experimentSpend } from "@/server/domain/agent/ledger";
import { buildUtmUrl, CONVERSION_EVENTS, EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { launchExperimentAction, startExperimentAction, stopExperimentAction } from "@/server/actions/growth";
import { deliveryEvidence, experimentCommitted, isPayableAddress } from "@/server/domain/growth/experiments";
import { loadPolicy } from "@/server/domain/agent/ledger";
import { DEFAULT_POLICY } from "@/server/domain/agent/policy";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Card, CardBody, CardFooter, CardHeader, ExternalLink, KeyValue, LinkButton, ModeBadge, PageHeader, Progress, Stat, StatusBadge, Table, TxStateBadge, shortHash } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { EvidenceList } from "@/components/features/intel/evidence";
import { ActionButton } from "@/components/features/agent/action-button";
import { ChainCheckBadge } from "@/components/features/wallet/chain-check-badge";
import { ManualConversionForm } from "@/components/features/experiments/manual-conversion";
import { RecipientForm } from "@/components/features/experiments/recipient-form";
import { DeliveryForm } from "@/components/features/experiments/delivery-form";
import { appOrigin } from "@/server/lib/origin";

const RAIL: Record<string, string> = { gateway_x402: "x402 · Gateway", app_kit_send: "App Kit Send", app_kit_bridge: "App Kit Bridge", gateway_deposit: "Gateway deposit" };

export default async function Experiment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role, db } = await requireProject();
  const [x] = await db.select().from(s.experiments).where(and(eq(s.experiments.id, id), eq(s.experiments.projectId, project.id)));
  if (!x) notFound();
  if (x.channel === "creator_program") {
    const [program] = await db.select().from(s.creatorPrograms).where(eq(s.creatorPrograms.experimentId, x.id));
    if (program) redirect(`/app/campaigns/${program.id}`);
  }
  const [[camp], spent, txs, funnel, ev, [manual]] = await Promise.all([
    db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, x.id)),
    experimentSpend(db, x.id),
    db.select().from(s.transactions).where(and(eq(s.transactions.experimentId, x.id), eq(s.transactions.projectId, project.id))).orderBy(desc(s.transactions.createdAt)),
    db
      .select({ type: s.conversionEvents.eventType, n: sql<number>`count(*)::int` })
      .from(s.attribution)
      .innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id))
      .where(eq(s.attribution.experimentId, x.id))
      .groupBy(s.conversionEvents.eventType),
    x.evidenceIds.length ? db.select().from(s.evidence).where(and(inArray(s.evidence.id, x.evidenceIds), eq(s.evidence.projectId, project.id))) : Promise.resolve([]),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.attribution)
      .innerJoin(s.conversionEvents, eq(s.attribution.conversionEventId, s.conversionEvents.id))
      .where(and(eq(s.attribution.experimentId, x.id), eq(s.conversionEvents.source, "manual"))),
  ]);
  const [kol] = camp?.kolId ? await db.select({ id: s.kols.id, handle: s.kols.handle, payoutAddress: s.kols.payoutAddress }).from(s.kols).where(eq(s.kols.id, camp.kolId)) : [];
  const recipient = kol ? kol.payoutAddress : x.recipientAddress;
  const payable = isPayableAddress(recipient);
  const [{ committedMicro }, policy, delivery] = await Promise.all([experimentCommitted(db, x.id), loadPolicy(db, project.id).catch(() => DEFAULT_POLICY), deliveryEvidence(db, x)]);
  const firstEnd = Math.min(x.stopAfterSpendMicro, x.budgetMicro);
  // The next payment: finish tranche 1 first, then tranche 2 — never more than the per-payment ceiling at once.
  const next = committedMicro < firstEnd ? { tranche: "first" as const, amount: Math.min(firstEnd - committedMicro, policy.hardCeilingMicro) } : committedMicro < x.budgetMicro ? { tranche: "second" as const, amount: Math.min(x.budgetMicro - committedMicro, policy.hardCeilingMicro) } : null;
  const conv = funnel.find((f) => f.type === x.successEvent)?.n ?? 0;
  const origin = await appOrigin();
  const link = camp?.destinationUrl ? buildUtmUrl(camp.destinationUrl, { source: camp.utmSource, medium: camp.utmMedium, campaign: camp.utmCampaign, ref: camp.referralCode }) : null;
  const firstPaid = txs.some((t) => t.state !== "REJECTED" && t.state !== "DENIED" && t.state !== "FAILED");
  const operate = can(role, "operate");
  // Tranche 2 pays on delivery: the link to the paid work has to be on record first.
  const awaitingDelivery = next?.tranche === "second" && !delivery;
  const cpa = conv ? Math.round(spent / conv) : null;
  const overStop = cpa != null && spent >= x.stopAfterSpendMicro && cpa > x.stopMaxCpaMicro;
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
            {operate && x.status === "proposed" && payable && next && <ActionButton action={launchExperimentAction.bind(null, x.id, next.tranche)} label={`Launch — pay ${fmtUsdc(next.amount)}`} icon={<Rocket />} variant="primary" logTitle="Launch experiment" />}
            {operate && x.status === "running" && firstPaid && !awaitingDelivery && next?.tranche === "second" && <ActionButton action={launchExperimentAction.bind(null, x.id, "second")} label="Release second tranche" icon={<Play />} logTitle="Second tranche" />}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Measured result" description="Spend from the ledger; conversions from attribution" icon={<Gauge />} action={outcome?.verdict ? <Badge tone={outcome.verdict === "SCALE" ? "good" : outcome.verdict === "STOP" || outcome.verdict === "REDUCE" ? "bad" : "neutral"}>{outcome.verdict}</Badge> : undefined} />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Spent" value={fmtUsdc(spent, { unit: false })} sub={`of ${fmtUsdc(x.budgetMicro, { unit: false })} USDC`} />
                <Stat label="Conversions" value={conv} sub={EVENT_LABEL[x.successEvent as ConversionEventType] ?? x.successEvent} />
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
                    <Badge key={f.type} tone={f.type === x.successEvent ? "info" : "neutral"}>
                      {EVENT_LABEL[f.type as ConversionEventType] ?? f.type} <span className="num">{f.n}</span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-ink-3">No attributed events yet — they arrive through the tracked link, the conversion webhook, or conversions you record by hand with this campaign’s referral code.</p>
              )}
              {(manual?.n ?? 0) > 0 && <p className="text-[11.5px] text-ink-3">{manual!.n} of these were recorded by hand (self-reported).</p>}
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
            <CardHeader title="Payments" description="Every payment follows your budget and spending rules and requires your approval." icon={<CreditCard />} />
            {txs.length ? (
              <Table>
                <thead>
                  <tr>
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
                      <td className="whitespace-nowrap">{RAIL[t.rail] ?? t.rail}</td>
                      <td className="num text-right">{fmtUsdc(t.amountMicro)}</td>
                      <td>
                        <span className="flex items-center gap-1">
                          <TxStateBadge state={t.state} />
                          {t.dataMode !== t.state && <ModeBadge mode={t.dataMode} />}
                          <ChainCheckBadge check={t.chainCheck} />
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
                  {camp.destinationUrl ? (
                    <div>
                      <div className="label mb-1.5">Tracked short link · records a visit</div>
                      <CopyField value={`${origin}/r/${camp.referralCode}`} />
                    </div>
                  ) : (
                    <p className="rounded-[8px] border border-line bg-bg/40 px-3 py-2 text-[12px] text-ink-2">
                      No website yet, so there&apos;s no tracked link. Ask customers to mention code <span className="num text-ink">{camp.referralCode}</span> and record them below.{" "}
                      <Link href="/app/settings" className="underline">
                        Add a website
                      </Link>{" "}
                      for future campaigns.
                    </p>
                  )}
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

          {camp && operate && (
            <Card>
              <CardHeader title="Record conversions by hand" description="No webhook? Log orders, bookings or signups that came from this campaign — for example customers who quoted the referral code." icon={<ClipboardPen />} />
              <CardBody>
                <ManualConversionForm experimentId={x.id} defaultEvent={x.successEvent} events={CONVERSION_EVENTS.filter((e) => e !== "visit").map((e) => ({ value: e, label: EVENT_LABEL[e] }))} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Run" icon={<Rocket />} />
            <CardBody className="space-y-3">
              {!operate ? (
                <p className="text-[12.5px] text-ink-3">Viewers can’t launch experiments.</p>
              ) : ["succeeded", "failed", "stopped"].includes(x.status) ? (
                <p className="text-[12.5px] text-ink-3">This experiment is {x.status}.{outcome?.reason ? ` ${outcome.reason}.` : ""}</p>
              ) : (
                <>
                  {payable && (
                    <div className="rounded-[8px] border border-line px-3 py-2 text-[12px] text-ink-2">
                      Pays <span className="text-ink">{kol ? `@${kol.handle}` : x.recipientLabel || "recipient"}</span> · <span className="num">{shortHash(recipient!)}</span>
                      {!kol && can(role, "manage_wallet") && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink">Change recipient</summary>
                          <div className="pt-2">
                            <RecipientForm experimentId={x.id} address={x.recipientAddress} label={x.recipientLabel} />
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  {x.status === "awaiting_approval" && (
                    <p className="text-[12.5px] text-ink-2">
                      The first payment is waiting for your decision in{" "}
                      <Link href="/app/approvals" className="text-ink underline">
                        Approvals
                      </Link>
                      .
                    </p>
                  )}
                  {committedMicro > 0 && (
                    <div className="text-[11.5px] text-ink-3">
                      Paid or awaiting approval: <span className="num text-ink-2">{fmtUsdc(committedMicro)}</span> of <span className="num">{fmtUsdc(x.budgetMicro)}</span>
                    </div>
                  )}
                  {x.status === "proposed" && payable && next && (
                    <ActionButton action={launchExperimentAction.bind(null, x.id, next.tranche)} label={`Launch — pay ${fmtUsdc(next.amount)}`} icon={<Rocket />} variant="primary" logTitle="Launch experiment" className="w-full" />
                  )}
                  {x.status === "running" && payable && next && awaitingDelivery && (
                    <p className="rounded-[8px] border border-line bg-bg/50 px-3 py-2 text-[12.5px] text-ink-2">
                      Tranche 2 ({fmtUsdc(x.budgetMicro - committedMicro)}) pays on delivery. Record the link to the delivered work under <span className="text-ink">Delivery</span> to release it.
                    </p>
                  )}
                  {x.status === "running" && payable && next && !awaitingDelivery && (
                    <ActionButton
                      action={launchExperimentAction.bind(null, x.id, next.tranche)}
                      label={next.tranche === "first" ? (firstPaid ? `Pay the rest of tranche 1 — ${fmtUsdc(next.amount)}` : `Fund it — pay ${fmtUsdc(next.amount)}`) : `Release tranche 2 — ${fmtUsdc(next.amount)}`}
                      icon={next.tranche === "first" ? <Rocket /> : <Play />}
                      logTitle={next.tranche === "first" ? "Fund experiment" : "Second tranche"}
                      className="w-full"
                    />
                  )}
                  {(x.status === "proposed" || (x.status === "running" && !firstPaid)) && !payable && next && (
                    kol ? (
                      <p className="text-[12.5px] text-ink-2">
                        To pay @{kol.handle}, add their USDC payout address on{" "}
                        <Link href={`/app/kols/${kol.id}`} className="text-ink underline">
                          their creator page
                        </Link>
                        . Ask them for it when you make contact.
                      </p>
                    ) : (
                      <RecipientForm experimentId={x.id} address={x.recipientAddress} label={x.recipientLabel} disabled={!can(role, "manage_wallet")} />
                    )
                  )}
                  {x.status === "proposed" && (
                    <ActionButton action={startExperimentAction.bind(null, x.id)} label="Run it myself — no payment" icon={<Hand />} logTitle="Start experiment" className="w-full" />
                  )}
                  <ActionButton action={stopExperimentAction.bind(null, x.id)} label="Stop experiment" icon={<CircleStop />} variant="ghost" confirm="Stop this experiment? Any payment still waiting for approval is rejected." className="w-full" />
                </>
              )}
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                Every payment follows your spending rules and requires approval. Tranche 1 ({fmtUsdc(firstEnd)}) is the amount at risk before the stop condition is evaluated; tranche 2 pays once the delivered work is on record. No single payment exceeds your workspace ceiling of {fmtUsdc(policy.hardCeilingMicro)}. Running it yourself costs nothing: share the tracked link and record results here.
              </p>
            </CardBody>
          </Card>

          {(delivery || (x.status === "running" && firstPaid)) && (
            <Card>
              <CardHeader title="Delivery" description="Tranche 2 pays once the paid work exists" icon={<PackageCheck />} action={delivery ? <Badge tone="good">Recorded</Badge> : <Badge tone="warn">Waiting</Badge>} />
              <CardBody className="space-y-3">
                {delivery ? (
                  <>
                    <a href={delivery.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 break-all text-[12.5px] text-s1 hover:underline">
                      {delivery.url} <ArrowUpRight className="size-3 shrink-0" />
                    </a>
                    {delivery.note && <p className="text-[12px] text-ink-2">{delivery.note}</p>}
                    <KeyValue
                      items={[
                        { k: "Recorded", v: `${relTime(new Date(delivery.recordedAt))}${delivery.recordedBy ? ` by ${delivery.recordedBy}` : ""}` },
                        { k: "Tracked visits since tranche 1", v: <span className="num">{delivery.visits}</span> },
                        { k: EVENT_LABEL[x.successEvent as ConversionEventType] ?? x.successEvent, v: <span className="num">{delivery.conversions}</span> },
                      ]}
                    />
                    {delivery.visits === 0 && <p className="text-[11.5px] text-ink-3">No tracked visits yet. Check the post includes the tracked link before releasing tranche 2.</p>}
                    {operate && x.status === "running" && (
                      <details>
                        <summary className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink">Change the link</summary>
                        <div className="pt-2">
                          <DeliveryForm experimentId={x.id} url={x.deliveryUrl} note={x.deliveryNote} />
                        </div>
                      </details>
                    )}
                  </>
                ) : operate ? (
                  <DeliveryForm experimentId={x.id} url={null} note={null} />
                ) : (
                  <p className="text-[12.5px] text-ink-3">Waiting for someone to record the delivered work.</p>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
