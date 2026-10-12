import { notFound } from "next/navigation";
import { CircleDollarSign, FlaskConical, Handshake, Link2, ListChecks, ReceiptText, ShieldCheck, Users } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { VERDICT_LABEL, customerAlias, loadCustomerValue, summarize } from "@/server/domain/growth/customer-value";
import { fmtUsdc } from "@/lib/money";
import { DAY_MS, relTime } from "@/lib/time";
import { fmtDate } from "@/server/queries/campaigns";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, ExternalLink, KeyValue, LinkButton, ModeBadge, PageHeader, Stat, StatStrip, TxStateBadge, shortHash } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { MetricValue, Ratio, VerdictBadge } from "@/components/features/customer-value/metric";

export const metadata = { title: "Campaign customer value" };

const usd = (v: number) => fmtUsdc(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const EVENT_LIMIT = 300;
const eventLabel = (t: string) => EVENT_LABEL[t as ConversionEventType] ?? t;

export default async function CampaignValue({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, db } = await requireProject();
  const r = await loadCustomerValue(db, project.id);
  // Only experiments of the current workspace are in the report, so a foreign id is simply not found.
  const row = r.rows.find((x) => x.experimentId === id);
  if (!row) notFound();
  const { cohort: c, cost, value: v, recommendation: rec } = row;
  const act = eventLabel(r.config.activationEvent);
  const alias = (cid: string) => customerAlias(project.id, cid);
  const outcomes = r.outcomes.filter((o) => o.experimentId === id).sort((a, b) => b.entryAt.getTime() - a.entryAt.getTime());
  const members = new Set(outcomes.map((o) => o.customerId));
  const linkName = new Map(row.links.map((l) => [l.id, l.name]));
  const events = r.events.filter((e) => e.experimentId === id || (e.customerId && members.has(e.customerId))).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const ledger = r.ledger.filter((t) => t.experimentId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const windowMs = r.config.repeatWindowDays * DAY_MS;
  const toneFor = rec.verdict === "stop_spending" ? "danger" : rec.verdict === "improve_funnel" ? "warn" : "info";

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Customer value", href: "/app/customer-value" }]}
        title={row.name}
        description={`${row.kind === "creator" ? "Creator campaign" : `Experiment · ${row.channel}`}${row.startsAt ? ` · started ${fmtDate(row.startsAt)}` : ""}. Every number on this page is traced to the events and payments listed below.`}
        meta={
          <>
            <ModeBadge mode={r.dataMode} />
            <VerdictBadge rec={rec} />
          </>
        }
        actions={
          <>
            {row.creatorCampaignId && (
              <LinkButton href={`/app/campaigns/${row.creatorCampaignId}`} variant="ghost" icon={<Handshake />}>
                Creator campaign
              </LinkButton>
            )}
            <LinkButton href={`/app/experiments/${row.experimentId}`} variant="ghost" icon={<FlaskConical />}>
              Experiment
            </LinkButton>
          </>
        }
      />

      <Callout tone={toneFor} title={`${VERDICT_LABEL[rec.verdict]}${rec.confidence === "early" ? " — early signal" : ""}`}>
        {rec.reason} {rec.next}
        <span className="mt-1 block text-[11.5px] text-ink-3">
          Rule: <span className="num">{rec.rule}</span> · see “How recommendations work” on the Customer value page.
        </span>
      </Callout>

      <StatStrip className="grid-cols-2 sm:grid-cols-5">
        <Stat label="Link visitors" value={c.linkVisitors} sub="distinct browsers or IDs" />
        <Stat label="Referred customers" value={c.referred} sub="with a customer ID" />
        <Stat label="Activated" value={<Ratio n={c.activated} of={c.referred} />} sub={act} />
        <Stat label="Paying" value={<Ratio n={c.paying} of={c.referred} />} sub={`${c.purchases} purchase${c.purchases === 1 ? "" : "s"}`} />
        <Stat label="Repeat" value={c.repeatEligible ? <Ratio n={c.repeat} of={c.repeatEligible} /> : "—"} sub={c.repeatEligible ? `of ${c.repeatEligible} past ${r.config.repeatWindowDays}d window` : `none past ${r.config.repeatWindowDays}d window yet`} />
      </StatStrip>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Value" icon={<CircleDollarSign />} description="Revenue is recorded; gross profit and payback are estimates from your margin." />
          <CardBody>
            <KeyValue
              items={[
                { k: "Recorded revenue", v: <MetricValue m={v.revenue} format={usd} /> },
                { k: `Estimated gross profit${r.config.marginPct != null ? ` (${r.config.marginPct}% margin)` : ""}`, v: <MetricValue m={v.grossProfit} format={usd} /> },
                { k: "Cost per paying customer", v: <MetricValue m={v.costPerPaying} format={usd} /> },
                ...(cost.pendingMicro > 0 ? [{ k: "…if pending payments settle", v: <MetricValue m={v.costPerPayingWithPending} format={usd} /> }] : []),
                { k: "Revenue ÷ confirmed spend", v: <MetricValue m={v.revenueMultiple} format={(x) => `${x.toFixed(2)}×`} /> },
                {
                  k: "Payback",
                  v: (
                    <span className="flex flex-col items-end gap-0.5">
                      <MetricValue m={v.payback} format={pct} />
                      {v.payback.value != null && <span className="text-[11px] text-ink-3">{v.payback.paidBackAt ? `Paid back on ${fmtDate(v.payback.paidBackAt)}` : v.payback.detail}</span>}
                    </span>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Cost" icon={<ShieldCheck />} description="From the payment ledger. Only settled payments are confirmed spend." />
          <CardBody>
            <KeyValue
              items={[
                { k: "Budget reserved", v: <span className="num">{fmtUsdc(cost.budgetMicro)}</span> },
                { k: "Confirmed spend (settled)", v: <span className="num font-medium">{fmtUsdc(cost.confirmedMicro)}</span> },
                { k: "Pending payments", v: <span className="num">{fmtUsdc(cost.pendingMicro)}</span> },
                ...(row.kind === "creator" ? [{ k: "Earned by creators, not yet paid", v: <span className="num">{fmtUsdc(cost.owedMicro)}</span> }] : []),
                ...(cost.simulatedMicro > 0 ? [{ k: "Simulated (nothing moved)", v: <span className="num">{fmtUsdc(cost.simulatedMicro)}</span> }] : []),
                ...(cost.notPaidMicro > 0 ? [{ k: "Denied, rejected or failed", v: <span className="num text-ink-3">{fmtUsdc(cost.notPaidMicro)}</span> }] : []),
                { k: "Reserved, not yet committed", v: <span className="num">{fmtUsdc(cost.uncommittedMicro)}</span> },
              ]}
            />
            {cost.testFundsMicro > 0 && <p className="mt-3 text-[11.5px] text-ink-3">Includes {fmtUsdc(cost.testFundsMicro)} of test funds on Arc Testnet.</p>}
          </CardBody>
        </Card>
      </div>

      {(c.unlinkedEvents > 0 || c.purchasedBefore > 0 || c.multiTouch > 0 || c.unvaluedPurchases > 0) && (
        <Card>
          <CardHeader title="Data notes" icon={<ListChecks />} description="Limits on what these numbers can tell you." />
          <ul className="divide-y divide-line text-[12.5px] text-ink-2">
            {c.unlinkedEvents > 0 && <li className="px-4 py-2.5">{c.unlinkedEvents} referred event{c.unlinkedEvents === 1 ? "" : "s"} arrived without a customer ID, so {c.unlinkedEvents === 1 ? "it" : "they"} can&apos;t be followed into purchases.</li>}
            {c.unvaluedPurchases > 0 && <li className="px-4 py-2.5">{c.unvaluedPurchases} purchase{c.unvaluedPurchases === 1 ? "" : "s"} had no value; revenue is understated by an unknown amount.</li>}
            {c.purchasedBefore > 0 && <li className="px-4 py-2.5">{c.purchasedBefore} referred customer{c.purchasedBefore === 1 ? " had" : "s had"} already purchased before their referral — existing customers, not new ones. Their earlier purchases are excluded.</li>}
            {c.multiTouch > 0 && <li className="px-4 py-2.5">{c.multiTouch} customer{c.multiTouch === 1 ? "" : "s"} also used another campaign&apos;s code later; they count only here, where they were referred first.</li>}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="By tracking link" icon={<Link2 />} description="Each link carries its own referral code. A customer belongs to the link of their first referral." />
        {row.links.length ? (
          <DataTable
            columns={[
              { key: "link", label: "Link" },
              { key: "visitors", label: "Visitors", align: "right" },
              { key: "referred", label: "Referred", align: "right" },
              { key: "activated", label: "Activated", align: "right" },
              { key: "paying", label: "Paying", align: "right" },
              { key: "revenue", label: "Revenue", align: "right" },
            ]}
            rows={row.links.map((l) => {
              const s = summarize(r.outcomes, r.events, id, l.id);
              return {
                id: l.id,
                cells: {
                  link: (
                    <span className="flex flex-col">
                      <span className="text-ink">{l.name}</span>
                      <span className="num text-[11px] text-ink-4">/r/{l.code}</span>
                    </span>
                  ),
                  visitors: <span className="num">{s.linkVisitors}</span>,
                  referred: <span className="num">{s.referred}</span>,
                  activated: <Ratio n={s.activated} of={s.referred} />,
                  paying: <Ratio n={s.paying} of={s.referred} />,
                  revenue: <span className="num">{s.valuedPurchases ? fmtUsdc(s.revenueMicro) : "—"}</span>,
                },
              };
            })}
          />
        ) : (
          <div className="p-4">
            <EmptyState icon={<Link2 />} title="No tracking links yet" description="Creator campaigns get one link per accepted creator. Accept a creator to create their link." />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Referred customers" icon={<Users />} description="Shown as workspace-only aliases. Raw customer IDs and event metadata are never displayed." />
        {outcomes.length ? (
          <DataTable
            searchable
            columns={[
              { key: "customer", label: "Customer" },
              { key: "via", label: "Referred via" },
              { key: "entry", label: "Referred", sortable: true },
              { key: "activated", label: "Activated" },
              { key: "purchases", label: "Purchases", align: "right", sortable: true },
              { key: "revenue", label: "Revenue", align: "right", sortable: true },
              { key: "repeat", label: "Repeat" },
            ]}
            defaultSort={{ key: "entry", dir: "desc" }}
            rows={outcomes.map((o) => {
              const first = o.purchases[0];
              const repeat = !first ? <span className="text-ink-4">—</span> : o.repeat ? <Badge tone="good">Yes</Badge> : o.repeatEligible ? <Badge tone="muted">No</Badge> : <span className="text-[11.5px] text-ink-3" title={`Window ends ${fmtDate(new Date(first.at.getTime() + windowMs))}`}>window open</span>;
              const a = alias(o.customerId);
              return {
                // Row ids are serialized to the browser — use the alias, never the raw customer ID.
                id: a,
                cells: {
                  customer: (
                    <span className="flex items-center gap-1.5">
                      <span className="num text-ink">{a}</span>
                      {o.purchasedBefore && <Badge tone="muted">existing</Badge>}
                      {o.otherCampaigns > 0 && <Badge tone="muted">multi-touch</Badge>}
                    </span>
                  ),
                  via: <span className="text-ink-2">{(o.linkId && linkName.get(o.linkId)) ?? "—"}</span>,
                  entry: (
                    <span className="flex flex-col">
                      <span>{eventLabel(o.entryEventType)}</span>
                      <span className="text-[11px] text-ink-4">{fmtDate(o.entryAt)}</span>
                    </span>
                  ),
                  activated: o.activatedAt ? <span className="text-[12px]">{fmtDate(o.activatedAt)}</span> : <span className="text-ink-4">No</span>,
                  purchases: <span className="num">{o.purchases.length}</span>,
                  revenue: <span className="num">{o.purchases.length ? (o.purchases.length === o.unvaluedPurchases ? "no value" : fmtUsdc(o.revenueMicro)) : "—"}</span>,
                  repeat,
                },
                sort: { entry: o.entryAt.getTime(), purchases: o.purchases.length, revenue: o.revenueMicro },
                search: `${a} ${(o.linkId && linkName.get(o.linkId)) ?? ""}`,
              };
            })}
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<Users />}
              title="No referred customers yet"
              description={
                c.linkVisitors > 0
                  ? `${c.linkVisitors} visitor${c.linkVisitors === 1 ? "" : "s"} used this campaign's links, but no customer event with a referral code and customer ID has arrived. Send signups or purchases with “ref” and “visitorId” through the events webhook.`
                  : "Nobody has used this campaign's links yet. Visits are recorded automatically; customer events come from your product through the events webhook."
              }
              action={
                <LinkButton href="/app/integrations" size="sm" variant="ghost">
                  Events webhook setup
                </LinkButton>
              }
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Underlying events" icon={<ListChecks />} description={`Events attributed to this campaign by referral code, plus later events from its referred customers.${events.length > EVENT_LIMIT ? ` Showing the latest ${EVENT_LIMIT} of ${events.length}.` : ""}`} />
        {events.length ? (
          <DataTable
            columns={[
              { key: "at", label: "When" },
              { key: "event", label: "Event" },
              { key: "customer", label: "Customer" },
              { key: "how", label: "Linked by" },
              { key: "value", label: "Value", align: "right" },
            ]}
            pageSize={50}
            rows={events.slice(0, EVENT_LIMIT).map((e) => ({
              id: e.id,
              cells: {
                at: (
                  <span className="flex flex-col">
                    <span className="text-[12px]">{fmtDate(e.occurredAt)}</span>
                    <span className="text-[11px] text-ink-4">{relTime(e.occurredAt)}</span>
                  </span>
                ),
                event: eventLabel(e.type),
                customer: e.customerId ? <span className="num text-ink-2">{e.type === "visit" ? "browser visit" : alias(e.customerId)}</span> : <span className="text-ink-4">no customer ID</span>,
                how: e.experimentId === id ? <span className="text-ink-2">Referral code{e.linkId && linkName.get(e.linkId) ? ` · ${linkName.get(e.linkId)}` : ""}</span> : e.experimentId ? <span className="text-ink-3">Customer ID (code of another campaign)</span> : <span className="text-ink-3">Customer ID</span>,
                value: <span className="num">{e.type === "purchase" ? (e.valueMicro > 0 ? fmtUsdc(e.valueMicro) : "no value") : "—"}</span>,
              },
            }))}
          />
        ) : (
          <div className="p-4">
            <EmptyState icon={<ListChecks />} title="No events yet" description="Events appear here as soon as someone uses one of this campaign's links or your product reports an event with its code." />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Payments and receipts" icon={<ReceiptText />} description="Every ledger entry booked to this campaign. Each links to its decision receipt (policy checks, approval, payment trail)." />
        {ledger.length ? (
          <DataTable
            columns={[
              { key: "at", label: "Created" },
              { key: "kind", label: "Payment" },
              { key: "state", label: "State" },
              { key: "counts", label: "Counts as" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "tx", label: "On-chain" },
              { key: "receipt", label: "" },
            ]}
            rows={ledger.map((t) => ({
              id: t.id,
              cells: {
                at: <span className="text-[12px]">{fmtDate(t.createdAt)}</span>,
                kind: (
                  <span className="flex items-center gap-1.5">
                    <span className="text-ink-2">{t.kind.replace(/_/g, " ")}</span>
                    <ModeBadge mode={t.dataMode} />
                  </span>
                ),
                state: <TxStateBadge state={t.state} />,
                counts: <span className="text-[12px] text-ink-3">{t.budgetCategory === "treasury" ? "Not spend (treasury)" : t.state === "SETTLED" ? "Confirmed spend" : t.state === "SIMULATED" ? "Simulated" : ["DENIED", "REJECTED", "FAILED"].includes(t.state) ? "Not paid" : "Pending"}</span>,
                amount: <span className="num">{fmtUsdc(t.amountMicro)}</span>,
                tx: t.explorerUrl ? <ExternalLink href={t.explorerUrl}>{shortHash(t.txHash, 4)}</ExternalLink> : <span className="text-ink-4">—</span>,
                receipt: (
                  <LinkButton href={`/app/receipts/${t.decisionId}`} size="sm" variant="ghost">
                    Receipt
                  </LinkButton>
                ),
              },
            }))}
          />
        ) : (
          <div className="p-4">
            <EmptyState icon={<ReceiptText />} title="No payments booked to this campaign" description={row.kind === "creator" ? "Creator payouts appear here once proposed from the creator campaign page. Earned rewards wait there until you pay them." : "Payments the agent makes for this experiment appear here with their receipts."} />
          </div>
        )}
      </Card>
    </div>
  );
}
