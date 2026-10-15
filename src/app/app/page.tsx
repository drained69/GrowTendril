import Link from "next/link";
import { and, count, desc, eq, gte, ne } from "drizzle-orm";
import { ArrowRight, Building2, CircleDollarSign, Coins, Flag, Globe, Plug, Radar, TrendingUp, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { balanceMicro, billingMode, priced } from "@/server/domain/billing";
import { autopilotCostLabel, servicePriceMicro } from "@/lib/services";
import { AUTOPILOT_LABEL } from "@/server/jobs/scheduler";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { activeMission, missionSummary, CATEGORY_LABEL } from "@/server/queries/missions";
import { recentDecisions, recentTransactions, spentTodayMicro } from "@/server/queries/activity";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { listConnections } from "@/server/integrations/vault";
import { activeJob } from "@/server/jobs/queue";
import { runCycleAction } from "@/server/actions/agent";
import { fmtUsdc } from "@/lib/money";
import { relTime, DAY_MS } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, Confidence, EmptyState, LinkButton, ModeBadge, Stat, StatusDot, TxStateBadge, Velocity, VerdictBadge, shortHash } from "@/components/ui";
import { GoalProgress, StackedBar, BarList, Sparkline } from "@/components/charts";
import { ActionButton } from "@/components/features/agent/action-button";
import { OverviewHero } from "@/components/features/workspace/overview-hero";
import { SetupSummary } from "@/components/features/workspace/setup-summary";
import { sourceAppliesTo } from "@/lib/source-readiness";
import { nextGrowthStep } from "@/lib/next-growth-step";
import { OpportunityCards } from "@/components/features/growth/opportunity-cards";

const more = (href: string, label = "View all") => (
  <Link href={href} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
    {label} <ArrowRight className="size-3" />
  </Link>
);

export default async function Overview({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const { user, project, role, db } = await requireProject();
  const pid = project.id;

  const [mission, wallet, connections, scanning, decisions, txs, spentToday] = await Promise.all([
    activeMission(db, pid),
    getWallet(db, pid),
    listConnections(db, pid),
    activeJob(db, pid, "cycle"),
    recentDecisions(db, pid, 7),
    recentTransactions(db, pid, 6),
    spentTodayMicro(db, pid),
  ]);
  const billingOn = billingMode() !== "off";
  const [[policy], [customerProfile], qualified, [topNarr], [topKol], issues, posts, credit, sum, plays, [approvals]] = await Promise.all([
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    db.select({ audience: s.productProfiles.audience }).from(s.productProfiles).where(eq(s.productProfiles.projectId, pid)),
    db.select().from(s.companies).where(eq(s.companies.projectId, pid)).orderBy(desc(s.companies.overallScore)).limit(6),
    db.select().from(s.narratives).where(eq(s.narratives.projectId, pid)).orderBy(desc(s.narratives.relevance), desc(s.narratives.velocityPct)).limit(1),
    db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, pid), eq(s.opportunities.type, "KOL"), ne(s.opportunities.status, "dismissed"))).orderBy(desc(s.opportunities.overallScore)).limit(1),
    db.select().from(s.productIssues).where(and(eq(s.productIssues.projectId, pid), gte(s.productIssues.mentions7d, 3))),
    db.select({ at: s.socialPosts.publishedAt }).from(s.socialPosts).where(and(eq(s.socialPosts.projectId, pid), gte(s.socialPosts.publishedAt, new Date(Date.now() - 14 * DAY_MS)))),
    billingOn ? balanceMicro(db, project.ownerId) : Promise.resolve(null),
    mission ? missionSummary(db, mission) : Promise.resolve(null),
    db.select().from(s.opportunities).where(and(eq(s.opportunities.projectId, pid), eq(s.opportunities.status, "open"))).orderBy(desc(s.opportunities.overallScore)).limit(3),
    db.select({ total: count() }).from(s.approvals).where(and(eq(s.approvals.projectId, pid), eq(s.approvals.status, "pending"))),
  ]);
  const quick =
    welcome === "quick"
      ? await Promise.all([db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, pid)), db.select().from(s.icps).where(eq(s.icps.projectId, pid))]).then(([[profile], icps]) => (profile ? { profile, icps } : null))
      : null;
  const daily = Array.from({ length: 14 }, (_, i) => posts.filter((p) => Math.floor((Date.now() - p.at.getTime()) / DAY_MS) === 13 - i).length);
  const live = walletIsLive(wallet);
  const connected = connections.filter((c) => c.ready && sourceAppliesTo(c, customerProfile?.audience)).length;

  const lowCredit = credit != null && credit < servicePriceMicro("scan");
  const next = nextGrowthStep({
    hasProfile: !!customerProfile, hasMission: !!mission, readySources: connected,
    scanStatus: scanning ? scanning.status === "queued" ? "queued" : "running" : null,
    hasScanned: !!project.lastCycleAt, creditMicro: credit, pendingApprovals: approvals.total,
    opportunityHref: plays[0] ? `/app/opportunities/${encodeURIComponent(plays[0].id)}` : undefined,
    permissions: { operate: can(role, "operate"), approve: can(role, "approve"), manageProfile: can(role, "manage_workspace"), managePolicy: can(role, "manage_policy"), manageIntegrations: can(role, "manage_integrations"), ownsCredit: project.ownerId === user.id },
  });
  const setup = [
    { done: !!mission, label: "Set a mission", detail: "A goal and a USDC budget to work against", href: "/app/missions", icon: <Flag /> },
    { done: !!customerProfile, label: "Review product context", detail: "What you sell and who it is for — drives discovery", href: "/app/settings#profile", icon: <Globe /> },
    { done: connected > 0, label: "Connect market sources", detail: `${connected} of ${connections.length} sources ready`, href: "/app/integrations", icon: <Plug /> },
    ...(credit != null ? [{ done: !lowCredit, label: "Add credit", detail: lowCredit ? `${fmtUsdc(credit)} left — a scan costs ${fmtUsdc(servicePriceMicro("scan"))}` : `${fmtUsdc(credit)} on the balance`, href: "/billing", icon: <Coins /> }] : []),
    { done: !!project.lastCycleAt, label: "Run the first scan", detail: scanning?.status === "queued" ? "Queued — waiting for the worker" : scanning ? "Scan in progress…" : "Collect evidence from connected sources", href: "/app/runs", icon: <Radar /> },
  ];
  const setupLeft = setup.filter((x) => !x.done).length;

  return (
    <div className="space-y-4">
      <OverviewHero
        name={user.isGuest ? "there" : user.name.split(" ")[0] || "there"}
        workspace={project.name}
        nextMove={next}
        chips={
          <>
            <ModeBadge mode={project.dataMode} />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-2.5 py-0.5">
              <StatusDot tone={scanning ? "info" : "good"} pulse />
              {scanning?.status === "queued" ? "Scan queued — waiting for the worker" : scanning ? "Scanning the market now" : project.lastCycleAt ? `Last cycle ${relTime(project.lastCycleAt)}` : "No cycle has run yet"}
            </span>
            {mission && sum && <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-2.5 py-0.5"><Flag className="size-3" />{sum.daysLeft} days left in “{mission.name}”</span>}
          </>
        }
        actions={
          <>
            {next.kind === "scan" ? <ActionButton action={runCycleAction} label={priced(next.label, "scan")} variant="primary" icon={<Radar />} /> : <LinkButton href={next.href} variant="primary" icon={<ArrowRight />}>{next.label}</LinkButton>}
            <LinkButton href="/app/discover" variant="outline" icon={<Radar />}>Browse evidence</LinkButton>
            <LinkButton href="/app/plan" variant="outline" icon={<ArrowRight />}>Growth plan</LinkButton>
            {can(role, "operate") && next.kind !== "scan" && <ActionButton action={runCycleAction} label={priced("Scan again", "scan")} variant="ghost" icon={<Radar />} disabled={!!scanning || lowCredit || connected === 0 || !customerProfile || !mission} />}
          </>
        }
      />

      {plays.length > 0 && (
        <section aria-labelledby="recommended-plays-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="recommended-plays-title" className="text-[19px] font-semibold tracking-[-0.02em] text-ink">Growth opportunities to review</h2><p className="mt-1 text-[13px] text-ink-3">Recommended from your collected signals. Review the evidence before choosing a test.</p></div><LinkButton href="/app/opportunities" icon={<ArrowRight />}>All opportunities</LinkButton></div>
          <OpportunityCards items={plays} />
        </section>
      )}

      {welcome === "quick" && quick && <SetupSummary website={project.website} profile={quick.profile} icps={quick.icps} mission={mission ?? null} scanning={!!scanning} scanStatus={scanning?.status} lowCredit={lowCredit} autopilot={credit != null ? `${AUTOPILOT_LABEL[project.autopilot] ?? project.autopilot} · ${autopilotCostLabel(project.autopilot)}` : undefined} />}

      {welcome && welcome !== "quick" && (
        <Callout tone="success" title="Workspace created">
          {scanning?.status === "queued"
            ? "The first market scan is queued, waiting for the worker. Check Agent runs for progress."
            : scanning
            ? "The first market scan is running in the background — evidence will appear here as it lands."
            : lowCredit
              ? `Your workspace is ready. Add credit to run its first market scan (${fmtUsdc(servicePriceMicro("scan"))}).`
              : "Your workspace is ready. Finish the checklist below so the operator can work end to end."}
        </Callout>
      )}

      {setupLeft > 0 && (
        <Card>
          <CardHeader
            title={project.lastCycleAt ? "Keep discovery ready" : "Prepare your first market scan"}
            description={`${setup.length - setupLeft} of ${setup.length} steps complete`}
            action={
              <span className="flex items-center gap-2">
                <span className="relative hidden h-1.5 w-28 overflow-hidden sm:block rounded-full bg-surface-3">
                  <span className="bar-grow absolute inset-y-0 left-0 rounded-full bg-good" style={{ width: `${((setup.length - setupLeft) / setup.length) * 100}%` }} />
                </span>
                <span className="num text-[11px] text-ink-3">{Math.round(((setup.length - setupLeft) / setup.length) * 100)}%</span>
              </span>
            }
          />
          <div className={`grid divide-line sm:grid-cols-2 sm:divide-x ${setup.length > 5 ? "lg:grid-cols-3" : "lg:grid-cols-5"}`}>
            {setup.map((x) => (
              <Link key={x.label} href={x.href} className="group flex items-start gap-3 border-t border-line px-4 py-3.5 transition-colors first:border-t-0 hover:bg-surface-2 sm:border-t-0">
                <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[7px] ring-1 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:rotate-[-6deg] [&_svg]:size-3.5 ${x.done ? "bg-good/10 text-good ring-good/25" : "bg-surface-2 text-ink-3 ring-line-strong"}`}>{x.icon}</span>
                <span className="min-w-0">
                  <span className={`block text-[12.5px] font-medium ${x.done ? "text-ink-3 line-through" : "text-ink"}`}>{x.label}</span>
                  <span className="block text-[11.5px] text-ink-3">{x.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!live && <p className="px-1 text-[12px] text-ink-3">Ready to pay a creator? <Link href="/app/wallet" className="font-medium text-ink-2 underline underline-offset-4">Set up the workspace wallet</Link> when you need an operating budget for payments.</p>}

      {mission && sum ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title={mission.name} description={mission.goalDescription} icon={<Flag />} action={<><ModeBadge mode={mission.dataMode} /><Badge>{sum.daysLeft}d left</Badge></>} />
            <CardBody>
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="text-[11.5px] font-medium text-ink-3">Progress</div>
                  <div className="num mt-1 text-[34px] font-medium leading-none tracking-[-0.03em]">
                    {sum.achieved}
                    <span className="text-[16px] text-ink-3"> / {mission.goalTarget}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  <Stat size="sm" label="Attributed" value={sum.attributed} sub="to experiments" />
                  <Stat size="sm" label="Cost / qualified" value={sum.costPerQualified ? fmtUsdc(sum.costPerQualified, { unit: false }) : "—"} sub="USDC, measured" />
                  <Stat size="sm" label="Efficiency" value={sum.efficiency} sub="score out of 100" />
                </div>
              </div>
              <div className="mt-4">
                <GoalProgress achieved={sum.achieved} goal={mission.goalTarget} pace={sum.pace} />
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
                  <span>Marker shows on-pace target ({Math.round(sum.pace)})</span>
                  <span className="num">{Math.round((sum.achieved / Math.max(1, mission.goalTarget)) * 100)}%</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Budget" icon={<CircleDollarSign />} action={more("/app/wallet", "Wallet")} />
            <CardBody>
              <div className="grid grid-cols-4 gap-3">
                <Stat size="sm" label="Total" value={fmtUsdc(mission.budgetMicro, { unit: false })} />
                <Stat size="sm" label="Spent" value={fmtUsdc(sum.spent, { unit: false })} />
                <Stat size="sm" label="Committed" value={fmtUsdc(sum.committed, { unit: false })} />
                <Stat size="sm" label="Available" value={fmtUsdc(sum.available, { unit: false })} tone="good" />
              </div>
              <div className="mt-4">
                <StackedBar total={mission.budgetMicro} parts={sum.allocation.map((a) => ({ key: a.category, label: CATEGORY_LABEL[a.category] ?? a.category, value: a.allocated, display: fmtUsdc(a.allocated, { unit: false }) }))} />
              </div>
            </CardBody>
            <CardFooter>
              <span>
                Today <span className="num text-ink">{fmtUsdc(spentToday)}</span> of {fmtUsdc(policy?.dailySpendMicro)}
              </span>
              <span className="flex items-center gap-1.5">
                <StatusDot tone={wallet?.frozen ? "bad" : live ? "good" : "warn"} />
                {wallet?.frozen ? "Frozen" : live ? "Wallet live · Arc mainnet" : "Payments disabled"}
              </span>
            </CardFooter>
          </Card>
        </div>
      ) : (
        <EmptyState icon={<Flag />} title="No active mission" description="A mission gives the operator a measurable goal and a budget ceiling. Nothing is spent without one." action={<LinkButton href="/app/missions" variant="primary">Create mission</LinkButton>} />
      )}

      {issues.map((b) => (
        <Callout
          key={b.id}
          tone="warn"
          title={`Product issue: ${b.label}`}
          action={<LinkButton href="/app/discover?filter=feedback" size="xs" variant="ghost">Evidence</LinkButton>}
        >
          {b.mentions7d} mentions this week ({b.changePct >= 0 ? "+" : ""}
          {b.changePct}%). {b.recommendation}
        </Callout>
      ))}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Qualified customers" icon={<Building2 />} action={more("/app/customers")} />
          {qualified.length ? (
            <ul className="divide-y divide-line">
              {qualified.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{c.name}</span>
                      <span className="num block text-[11px] text-ink-3">intent {c.intentScore} · fit {c.fitScore}</span>
                    </span>
                    <Confidence value={c.confidence} compact />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">No companies with buying intent yet. They appear as evidence is collected.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Top narrative" icon={<TrendingUp />} action={more("/app/narratives")} />
          <CardBody>
            {topNarr ? (
              <Link href={`/app/narratives/${topNarr.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{topNarr.label}</span>
                  <Velocity pct={topNarr.velocityPct} />
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                  <Badge tone="info">{topNarr.status}</Badge>
                  <span>
                    <span className="num">{topNarr.volume7d}</span> posts this week · relevance <span className="num">{topNarr.relevance}</span>
                  </span>
                </div>
                <div className="mt-4">
                  <div className="label mb-1.5">Market volume · 14 days</div>
                  <Sparkline values={daily} width={300} height={40} label="relevant posts" />
                </div>
              </Link>
            ) : (
              <p className="text-[12.5px] text-ink-3">No narratives yet — they form once enough related posts cluster together.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top creator opportunity" icon={<Users />} action={more("/app/kols")} />
          <CardBody>
            {topKol ? (
              <Link href={`/app/opportunities/${topKol.id}`} className="block">
                <div className="text-[14px] font-semibold leading-snug">{topKol.title}</div>
                <ul className="mt-2.5 space-y-1.5 text-[12px] leading-snug text-ink-2">
                  {topKol.whyNow.slice(0, 3).map((w, iw) => (
                    <li key={`${iw}:${w}`} className="flex gap-2">
                      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-ink-4" />
                      {w}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between">
                  <Confidence value={topKol.confidence} />
                  <span className="num text-[11.5px] text-ink-3">est. {fmtUsdc(topKol.estimatedCostMicro)}</span>
                </div>
              </Link>
            ) : (
              <p className="text-[12.5px] text-ink-3">No open creator opportunities.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Experiment performance" description="Cost per qualified conversion, lower is better" action={more("/app/experiments", "Experiments")} />
          <CardBody>
            {sum?.findings.some((f) => f.cpaMicro != null) ? (
              <BarList
                format={(v) => fmtUsdc(v, { unit: false })}
                rows={sum.findings.filter((f) => f.cpaMicro != null).map((f) => ({ label: f.label, value: f.cpaMicro!, sub: `${f.conversions} conv · ${f.verdict}`, tone: f.verdict === "STOP" || f.verdict === "REDUCE" ? "bad" : f.verdict === "SCALE" ? "good" : undefined }))}
              />
            ) : (
              <p className="text-[12.5px] text-ink-3">No measured experiments yet.</p>
            )}
          </CardBody>
          <CardFooter>From settled spend and referral-code attribution only.</CardFooter>
        </Card>

        <Card>
          <CardHeader title="Recent agent decisions" action={more("/app/receipts", "Receipts")} />
          {decisions.length ? (
            <ul className="divide-y divide-line">
              {decisions.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/receipts/${d.id}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <span className="num pt-px text-[11px] text-ink-4">#{d.number}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[12px]">
                        <span className="font-medium text-ink">{d.kind.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                        <span className="text-ink-4">·</span>
                        <span className="text-ink-3">{d.agent}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 block text-[12px] text-ink-3">{d.rationale}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <VerdictBadge verdict={d.policyVerdict} />
                      <span className="text-[10.5px] text-ink-4">{relTime(d.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-ink-3">No decisions yet — run a cycle to let the agents evaluate opportunities.</CardBody>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Payments" description="x402 nanopayments and on-chain transfers on Arc" action={more("/app/activity", "Full trace")} />
        {txs.length ? (
          <ul className="divide-y divide-line">
            {txs.map((t) => (
              <li key={t.id} className="grid grid-cols-[120px_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-[12px]">
                <span className="num text-ink-3">{t.rail.replace(/_/g, " ")}</span>
                <span className="truncate text-ink-2">
                  {t.kind.replace(/_/g, " ")} · {t.settlementId ? `settlement ${shortHash(t.settlementId, 4)}` : t.txHash ? shortHash(t.txHash) : "no on-chain reference"}
                </span>
                <span className="num">{fmtUsdc(t.amountMicro)}</span>
                <span className="flex items-center gap-1.5">
                  <ModeBadge mode={t.dataMode} />
                  <TxStateBadge state={t.state} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody className="text-[12.5px] text-ink-3">No payments yet.</CardBody>
        )}
      </Card>
    </div>
  );
}
