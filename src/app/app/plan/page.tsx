import Link from "next/link";
import { ArrowRight, Brain, Download, Mail, FlaskConical, Gift, Handshake, Map as MapIcon, Megaphone, PenLine, Search, ShieldCheck, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { buildGrowthPlan, type PlanItem, type PlanTrack, type TrackKey } from "@/server/domain/growth/plan";
import { fmtUsdc } from "@/lib/money";
import { emailReportAction } from "@/server/actions/reports";
import { ActionButton } from "@/components/features/agent/action-button";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Stat, StatStrip, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const ICON: Record<TrackKey, React.ReactNode> = {
  outreach: <Users />,
  creators: <Megaphone />,
  content: <PenLine />,
  partnerships: <Handshake />,
  bounties: <Gift />,
  experiments: <FlaskConical />,
  research: <Search />,
};

const STATUS_TONE: Record<string, Tone> = {
  running: "good",
  succeeded: "good",
  accelerating: "good",
  experiment: "info",
  proposed: "info",
  awaiting_approval: "warn",
  emerging: "info",
  idea: "muted",
  "contact first": "good",
  "worth a test": "info",
  watch: "muted",
  stopped: "bad",
  failed: "bad",
};

function Owner({ owner }: { owner: PlanItem["owner"] }) {
  return <Badge tone={owner === "growtendril" ? "accent" : "neutral"}>{owner === "growtendril" ? "GrowTendril" : "You"}</Badge>;
}

function Item({ i }: { i: PlanItem }) {
  return (
    <li>
      <Link href={i.href} className="group flex items-start gap-3 px-5 py-3 hover:bg-surface-2/60">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-ink group-hover:underline">{i.title}</span>
            {i.status && <Badge tone={STATUS_TONE[i.status] ?? "muted"}>{i.status.replace(/_/g, " ")}</Badge>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{i.detail}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Owner owner={i.owner} />
          {i.costMicro ? <span className="num text-[11px] text-ink-4">est. {fmtUsdc(i.costMicro)}</span> : null}
        </div>
      </Link>
    </li>
  );
}

function Track({ t }: { t: PlanTrack }) {
  const budget = t.allocatedMicro > 0;
  return (
    <Card id={t.key} className="scroll-mt-4">
      <CardHeader
        icon={ICON[t.key]}
        title={t.title}
        description={t.purpose}
        action={budget ? <span className="num whitespace-nowrap text-[11.5px] text-ink-3">{fmtUsdc(t.allocatedMicro, { unit: false })} USDC</span> : undefined}
      />
      {budget && (
        <div className="border-b border-line px-5 py-2.5">
          <Progress value={t.usedMicro} max={t.allocatedMicro} />
          <div className="mt-1 flex justify-between text-[11px] text-ink-4">
            <span>{t.key === "experiments" ? "Spent" : "Used"} {fmtUsdc(t.usedMicro)}</span>
            <span>{t.key === "experiments" ? "reserved by live experiments" : "of this slice"}</span>
          </div>
        </div>
      )}
      {t.items.length ? (
        <ul className="divide-y divide-line">
          {t.items.map((i) => (
            <Item key={`${i.href}-${i.title}`} i={i} />
          ))}
        </ul>
      ) : (
        <CardBody className="text-[12.5px] text-ink-3">{t.empty}</CardBody>
      )}
    </Card>
  );
}

export default async function GrowthPlanPage() {
  const { project, db } = await requireProject();
  const plan = await buildGrowthPlan(db, project.id);
  const m = plan.mission;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Growth plan"
        description="Everything GrowTendril proposes for your goal in one place: who to reach, which creators to brief, what to publish, which tests to run, and what each costs. You stay in charge of every contact and every payment to a person."
        actions={
          <>
            <LinkButton href="/app/plan/export" icon={<Download />}>
              Markdown
            </LinkButton>
            <ActionButton action={emailReportAction.bind(null, "plan")} label="Email me" icon={<Mail />} />
            <LinkButton href="/app/missions" icon={<MapIcon />} variant="primary">
              Goal & budget
            </LinkButton>
          </>
        }
      />

      {!m ? (
        <Card>
          <EmptyState icon={<MapIcon />} title="No active goal" description="A growth plan is built around a goal and a budget. Set one and GrowTendril drafts the plan on its next scan." action={<LinkButton href="/onboarding?step=3" variant="primary">Set a goal</LinkButton>} />
        </Card>
      ) : (
        <>
          <Callout tone="info" title={m.name}>
            {plan.focus}
          </Callout>

          <StatStrip className="grid-cols-2 sm:grid-cols-5">
            <Stat label="Progress" value={`${m.achieved} / ${m.target}`} sub={`${m.daysLeft} days left`} />
            <Stat label="Budget" value={fmtUsdc(m.budgetMicro, { unit: false })} sub="USDC for this goal" />
            <Stat label="Spent" value={fmtUsdc(m.spentMicro, { unit: false })} sub="settled + in flight" />
            <Stat label="Committed" value={fmtUsdc(m.committedMicro, { unit: false })} sub="reserved by experiments" />
            <Stat label="Available" value={fmtUsdc(m.availableMicro, { unit: false })} sub="not yet planned" tone="good" />
          </StatStrip>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader icon={<ArrowRight />} title="Next actions" description="The highest-value steps across the plan, in order." />
              {plan.nextActions.length ? (
                <ol className="divide-y divide-line">
                  {plan.nextActions.map((a, n) => (
                    <li key={`${a.href}-${a.title}`} className="flex items-start gap-3 pl-5">
                      <span className="num mt-3 w-4 shrink-0 text-[12px] text-ink-4">{n + 1}</span>
                      <ul className="min-w-0 flex-1">
                        <Item i={a} />
                      </ul>
                    </li>
                  ))}
                </ol>
              ) : (
                <CardBody className="text-[12.5px] text-ink-3">Nothing to do yet. The next scan fills this in.</CardBody>
              )}
            </Card>

            <Card>
              <CardHeader icon={<ShieldCheck />} title="Spending rules" description="Enforced in code on every payment." action={<Link href="/app/settings#policy" className="text-[11.5px] text-ink-3 hover:text-ink">Change</Link>} />
              <CardBody className="space-y-2.5 text-[12.5px] text-ink-2">
                <p>
                  {plan.rules.autonomyEnabled ? (
                    <>
                      GrowTendril buys research, data and API services <span className="text-ink">on its own up to {fmtUsdc(plan.rules.autonomousLimitMicro)}</span> per payment.
                    </>
                  ) : (
                    <>
                      <span className="text-ink">Every payment asks you first.</span> Set an autonomous limit to let GrowTendril buy research and data on its own.
                    </>
                  )}
                </p>
                <p>
                  Daily limit <span className="num text-ink">{fmtUsdc(plan.rules.dailyMicro)}</span> · hard ceiling <span className="num text-ink">{fmtUsdc(plan.rules.ceilingMicro)}</span> per payment.
                </p>
                <p className="text-ink-3">Payments to people — creators, bounties, partners — always need your approval. GrowTendril never messages anyone; you make every contact.</p>
              </CardBody>
              {plan.learned.length > 0 && (
                <>
                  <div className="flex items-center gap-2 border-t border-line px-5 pb-1 pt-3 text-[12px] font-medium text-ink">
                    <Brain className="size-3.5 text-ink-3" /> What the results say
                  </div>
                  <ul className="space-y-1.5 px-5 pb-4 pt-1 text-[12px] text-ink-2">
                    {plan.learned.map((l) => (
                      <li key={l.label}>
                        <span className="font-medium text-ink">{l.label}</span> — <span className="text-ink-3">{l.verdict.replace(/_/g, " ").toLowerCase()}:</span> {l.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {plan.tracks.map((t) => (
              <Track key={t.key} t={t} />
            ))}
          </div>

          <Card>
            <CardFooter>
              <span>The plan rebuilds after every scan. Results decide where the budget goes: experiments that miss their stop rule are stopped and unspent budget moves to what works, through the same spending rules.</span>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
