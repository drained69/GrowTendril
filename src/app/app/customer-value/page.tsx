import Link from "next/link";
import { ArrowRight, Gem, ListChecks, PlugZap, Scale, SlidersHorizontal } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { CONVERSION_EVENTS, EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { LOW_ACTIVATION_RATE, MIN_PAYING_FOR_COST, MIN_REFERRED_FOR_JUDGEMENT, RULES, STOP_RECOVERY_SHARE, VERDICT_LABEL, loadCustomerValue } from "@/server/domain/growth/customer-value";
import { fmtUsdc } from "@/lib/money";
import { Badge, Callout, Card, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatStrip } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { DefinitionsForm } from "@/components/features/customer-value/definitions-form";
import { MetricValue, Ratio, VerdictBadge } from "@/components/features/customer-value/metric";

export const metadata = { title: "Customer value" };

const usd = (v: number) => fmtUsdc(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function CustomerValue() {
  const { project, role, db } = await requireProject();
  const r = await loadCustomerValue(db, project.id);
  const { config, rows } = r;
  const act = EVENT_LABEL[config.activationEvent as ConversionEventType] ?? config.activationEvent;
  const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + f(x), 0);
  const referred = sum((x) => x.cohort.referred);
  const paying = sum((x) => x.cohort.paying);
  const repeatEligible = sum((x) => x.cohort.repeatEligible);
  const revenue = sum((x) => x.cohort.revenueMicro);
  const confirmed = sum((x) => x.cost.confirmedMicro);
  const pending = sum((x) => x.cost.pendingMicro);
  const anyValued = rows.some((x) => x.cohort.valuedPurchases > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer value"
        description="Which campaigns bring customers who activate, buy and come back — and whether they were worth what the campaign cost. Built only from your own events and your payment ledger."
        meta={
          <>
            <ModeBadge mode={r.dataMode} />
            <span>
              Activated = <span className="text-ink-2">{act}</span>
            </span>
            <span className="text-ink-4">·</span>
            <span>
              Repeat = 2nd purchase within <span className="num text-ink-2">{config.repeatWindowDays}</span> days
            </span>
            <span className="text-ink-4">·</span>
            <span>Margin: {config.marginPct != null ? <span className="num text-ink-2">{config.marginPct}% (assumption)</span> : "not set"}</span>
          </>
        }
        actions={
          <LinkButton href="#definitions" variant="ghost" icon={<SlidersHorizontal />}>
            Definitions
          </LinkButton>
        }
      />

      <Callout title="Referred is not the same as caused">
        A referred customer used a campaign&apos;s link or code. Some of them would have found you anyway, so these numbers show where customers came from — not how many sales a campaign added. To measure lift, compare against a period or audience without the campaign.
      </Callout>

      {(r.refundedMicro > 0 || r.unmatchedRefunds > 0) && <Callout title="Refund-adjusted revenue">{fmtUsdc(r.refundedMicro)} returned on matched referred orders. Fully refunded orders no longer count as paying customers. {r.unmatchedRefunds > 0 ? `${r.unmatchedRefunds} refund events need matching purchase records.` : ""}</Callout>}

      {r.gaps.length > 0 && (
        <Card>
          <CardHeader title="What's needed next" icon={<PlugZap />} description="Numbers below are only as complete as the events your product sends. Most fundamental first." />
          <ul className="divide-y divide-line">
            {r.gaps.map((g) => (
              <li key={g.key} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-ink">{g.title}</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{g.detail}</p>
                </div>
                <Link href={g.href} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12px] text-s1 hover:underline">
                  {g.href.startsWith("#") ? "Set below" : "Set up"} <ArrowRight className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length > 0 && (
        <StatStrip className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Referred customers" value={referred} sub="first referral wins" />
          <Stat label="Activated" value={<Ratio n={sum((x) => x.cohort.activated)} of={referred} />} sub={act} />
          <Stat label="Paying" value={<Ratio n={paying} of={referred} />} sub="≥1 purchase after referral" />
          <Stat label="Repeat" value={repeatEligible ? <Ratio n={sum((x) => x.cohort.repeat)} of={repeatEligible} /> : "—"} sub={repeatEligible ? `of ${repeatEligible} past the window` : "no cohort past the window yet"} />
          <Stat label="Net recorded revenue" value={anyValued ? fmtUsdc(revenue) : "—"} sub={anyValued ? "purchase values less matched refunds" : "no purchase values yet"} />
          <Stat label="Confirmed spend" value={fmtUsdc(confirmed)} sub={pending ? `+ ${fmtUsdc(pending)} pending` : "settled payments only"} />
        </StatStrip>
      )}

      <Card>
        <CardHeader title="Campaign comparison" icon={<Scale />} description={`Cost per paying customer and payback use confirmed (settled) spend only. Hover a figure for how it was calculated.`} />
        {rows.length ? (
          <DataTable
            defaultSort={{ key: "paying", dir: "desc" }}
            columns={[
              { key: "name", label: "Campaign", sortable: true, className: "min-w-[200px]" },
              { key: "referred", label: "Referred", align: "right", sortable: true },
              { key: "activated", label: "Activated", align: "right", sortable: true },
              { key: "paying", label: "Paying", align: "right", sortable: true },
              { key: "repeat", label: "Repeat", align: "right", sortable: true },
              { key: "revenue", label: "Revenue", align: "right", sortable: true },
              { key: "cost", label: "Confirmed cost", align: "right", sortable: true },
              { key: "cpp", label: "Cost / paying", align: "right", sortable: true },
              { key: "payback", label: "Payback", align: "right", sortable: true },
              { key: "rec", label: "Recommendation" },
            ]}
            rows={rows.map((x) => ({
              id: x.experimentId,
              href: `/app/customer-value/${x.experimentId}`,
              cells: {
                name: (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink">{x.name}</span>
                    <span className="text-[11px] text-ink-4">
                      {x.kind === "creator" ? "Creator campaign" : `Experiment · ${x.channel}`} · {x.links.length} link{x.links.length === 1 ? "" : "s"}
                    </span>
                  </span>
                ),
                referred: <span className="num">{x.cohort.referred}</span>,
                activated: <Ratio n={x.cohort.activated} of={x.cohort.referred} />,
                paying: <Ratio n={x.cohort.paying} of={x.cohort.referred} />,
                repeat: x.cohort.repeatEligible ? <Ratio n={x.cohort.repeat} of={x.cohort.repeatEligible} /> : <span className="text-[11.5px] text-ink-4" title="No paying customer is past the repeat window yet">—</span>,
                revenue: <MetricValue m={x.value.revenue} format={usd} compact />,
                cost: (
                  <span className="flex flex-col items-end whitespace-nowrap">
                    <span className="num">{fmtUsdc(x.cost.confirmedMicro)}</span>
                    {x.cost.pendingMicro > 0 && <span className="num text-[11px] text-ink-4">+{fmtUsdc(x.cost.pendingMicro)} pending</span>}
                  </span>
                ),
                cpp: <MetricValue m={x.value.costPerPaying} format={usd} compact />,
                payback: <MetricValue m={x.value.payback} format={pct} compact />,
                rec: <VerdictBadge rec={x.recommendation} />,
              },
              sort: {
                name: x.name,
                referred: x.cohort.referred,
                activated: x.cohort.activated,
                paying: x.cohort.paying,
                repeat: x.cohort.repeatEligible ? x.cohort.repeat / x.cohort.repeatEligible : null,
                revenue: x.value.revenue.value,
                cost: x.cost.confirmedMicro,
                cpp: x.value.costPerPaying.value,
                payback: x.value.payback.value,
              },
            }))}
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Gem />}
              title="No campaigns to compare yet"
              description="A campaign appears here once it has a tracking link. Creator campaigns get one link per invited creator; experiments get one when launched."
              action={
                <LinkButton href="/app/campaigns" variant="primary" size="sm">
                  Creator campaigns
                </LinkButton>
              }
            />
          </div>
        )}
        {(r.untrackedExperiments > 0 || r.duplicatesRemoved > 0) && (
          <div className="space-y-0.5 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
            {r.untrackedExperiments > 0 && <div>{r.untrackedExperiments} experiment{r.untrackedExperiments === 1 ? " has" : "s have"} no tracking link and can&apos;t refer customers, so {r.untrackedExperiments === 1 ? "it isn't" : "they aren't"} listed.</div>}
            {r.duplicatesRemoved > 0 && <div>{r.duplicatesRemoved} duplicate event{r.duplicatesRemoved === 1 ? " was" : "s were"} ignored (same customer and order ID, or the same event sent twice).</div>}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card id="definitions">
          <CardHeader title="Definitions" icon={<SlidersHorizontal />} description="Exactly what each number means. Changing these recalculates every campaign." />
          <dl className="divide-y divide-line px-4 text-[12.5px]">
            {[
              ["Customer", "One customer ID — the “visitorId” your product sends with its events. Events without one can't join a cohort."],
              ["Referred", "A customer whose earliest event carrying a referral code (other than a link visit) belongs to this campaign. If they used several campaigns' codes, only the first counts."],
              ["Activated", `A referred customer who sent “${act}” at or after their referral.`],
              ["Paying", "A referred customer with at least one purchase at or after their referral. Purchases before it mark an existing customer."],
              ["Repeat", `A paying customer whose second purchase came within ${config.repeatWindowDays} days of the first. The rate only counts customers whose first purchase is at least ${config.repeatWindowDays} days old (or who already repeated).`],
              ["Revenue", "The sum of recorded purchase values. Never estimated; purchases without a value add nothing."],
              ["Cost", "From the payment ledger: settled payments are confirmed spend; anything proposed, awaiting approval or not yet settled is pending. The campaign budget is reserved, not spent."],
              ["Gross profit & payback", "Estimates: recorded revenue × your gross margin, compared with confirmed spend."],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[120px_1fr] sm:gap-4">
                <dt className="font-medium text-ink">{k}</dt>
                <dd className="leading-relaxed text-ink-3">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line">
            <DefinitionsForm
              events={CONVERSION_EVENTS.filter((e) => e !== "visit").map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
              activationEvent={config.activationEvent}
              repeatWindowDays={config.repeatWindowDays}
              marginPct={config.marginPct}
              saved={config.saved}
              disabled={!can(role, "manage_policy")}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="How recommendations work" icon={<ListChecks />} description="Rules are checked in this order; the first that matches decides. “Early” means the sample is below the minimum — a direction, not a conclusion." />
          <ol className="divide-y divide-line">
            {RULES.map((rule, i) => (
              <li key={rule.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="num mt-px w-4 shrink-0 text-right text-ink-4">{i + 1}</span>
                <span className="min-w-0 flex-1 leading-relaxed text-ink-2">{rule.when}</span>
                <Badge tone={rule.verdict === "stop_spending" ? "bad" : rule.verdict === "improve_funnel" ? "warn" : "info"}>{VERDICT_LABEL[rule.verdict]}</Badge>
              </li>
            ))}
          </ol>
          <div className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-3">
            Thresholds: {MIN_REFERRED_FOR_JUDGEMENT} referred customers before any judgement, {MIN_PAYING_FOR_COST} paying before cost per customer counts, activation below {Math.round(LOW_ACTIVATION_RATE * 100)}% flags the funnel, and “stop” on payback needs most payers past the repeat window with under {Math.round(STOP_RECOVERY_SHARE * 100)}% recovered. The stop-after-spend threshold is each campaign&apos;s own.
          </div>
        </Card>
      </div>
    </div>
  );
}
