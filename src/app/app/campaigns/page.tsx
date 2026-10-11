import { Handshake, Plus } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { EVENT_LABEL, type ConversionEventType } from "@/server/domain/growth/attribution-links";
import { campaignStatus, fmtDate, listCampaigns } from "@/server/queries/campaigns";
import { fmtUsdc } from "@/lib/money";
import { Badge, Card, CardFooter, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Creator campaigns" };

const STEPS = [
  "You set the action you want, the most one is worth, and a test budget.",
  "GrowTendril plans a two-week test and explains every number.",
  "Creators opt in through a public link and see the exact rules before posting.",
  "You review posts against a rubric; verified actions arrive through each creator’s own link.",
  "Payouts go through your spend policy and approval inbox, with the reason for every line.",
];

export default async function Campaigns() {
  const { project, role, db } = await requireProject();
  const operate = can(role, "operate");
  const rows = await listCampaigns(db, project.id);
  const open = rows.filter((r) => campaignStatus(r.campaign).key === "open").length;
  const accepted = rows.reduce((n, r) => n + r.accepted, 0);
  const applied = rows.reduce((n, r) => n + r.applied, 0);
  const paid = rows.reduce((n, r) => n + r.ledger.paidMicro, 0);
  const verified = rows.reduce((n, r) => n + r.ledger.verifiedMicro, 0);
  const inPayout = rows.reduce((n, r) => n + r.ledger.inPayoutMicro, 0);
  const newButton = operate ? (
    <LinkButton href="/app/campaigns/new" variant="primary" icon={<Plus />}>
      New campaign
    </LinkButton>
  ) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Creator campaigns"
        description="Small, measurable creator tests. Creators opt in under rules they see before posting; you pay for accepted posts and verified customer actions — and every payout line says why."
        meta={<ModeBadge mode={project.dataMode} />}
        actions={newButton}
      />

      {rows.length ? (
        <>
          <StatStrip className="grid-cols-2 lg:grid-cols-4">
            <Stat label="Open campaigns" value={open} sub={`${rows.length} total`} />
            <Stat label="Creators accepted" value={accepted} sub={applied ? `${applied} waiting for review` : "no pending applications"} />
            <Stat label="Paid out" value={fmtUsdc(paid, { unit: false })} sub="USDC, submitted or settled on-chain" />
            <Stat label="Verified & unpaid" value={fmtUsdc(verified, { unit: false })} sub={inPayout ? `${fmtUsdc(inPayout, { unit: false })} already in a payout` : "earned, not yet paid"} tone={verified > 0 ? "warn" : undefined} />
          </StatStrip>

          <Card>
            <CardHeader title="All campaigns" icon={<Handshake />} />
            <DataTable
              searchable
              defaultSort={{ key: "number", dir: "desc" }}
              columns={[
                { key: "name", label: "Campaign" },
                { key: "status", label: "Status", sortable: true },
                { key: "target", label: "Target action", sortable: true },
                { key: "budget", label: "Budget", align: "right", sortable: true },
                { key: "paid", label: "Paid", align: "right", sortable: true },
                { key: "verified", label: "Verified", align: "right", sortable: true },
                { key: "creators", label: "Creators", align: "right", sortable: true },
                { key: "ends", label: "Ends", sortable: true },
              ]}
              rows={rows.map(({ campaign: c, ledger, accepted: acc, applied: app }) => {
                const st = campaignStatus(c);
                const target = EVENT_LABEL[c.targetEvent as ConversionEventType] ?? c.targetEvent;
                return {
                  id: c.id,
                  href: `/app/campaigns/${c.id}`,
                  cells: {
                    name: (
                      <span className="block max-w-[340px]">
                        <span className="flex items-center gap-1.5">
                          <span className="num font-normal text-ink-4">#{c.number}</span>
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="block truncate text-[11.5px] font-normal text-ink-3">{c.topic}</span>
                      </span>
                    ),
                    status: (
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={st.key === "ended" ? "pending" : st.key} label={st.label} />
                        <ModeBadge mode={c.dataMode} />
                      </span>
                    ),
                    target: (
                      <span className="whitespace-nowrap text-ink-2">
                        {target} <span className="num text-[11.5px] text-ink-3">≤ {fmtUsdc(c.maxCostPerActionMicro, { unit: false })}</span>
                      </span>
                    ),
                    budget: <span className="num">{fmtUsdc(c.budgetMicro, { unit: false })}</span>,
                    paid: <span className="num">{fmtUsdc(ledger.paidMicro, { unit: false })}</span>,
                    verified: <span className="num text-ink-2">{fmtUsdc(ledger.verifiedMicro, { unit: false })}</span>,
                    creators: (
                      <span className="num whitespace-nowrap">
                        {acc}/{c.maxCreators}
                        {app > 0 && (
                          <Badge tone="warn" className="ml-1.5">
                            {app} new
                          </Badge>
                        )}
                      </span>
                    ),
                    ends: <span className="num whitespace-nowrap text-ink-3">{fmtDate(c.endsAt)}</span>,
                  },
                  sort: { number: c.number, status: st.key, target, budget: c.budgetMicro, paid: ledger.paidMicro, verified: ledger.verifiedMicro, creators: acc, ends: c.endsAt.getTime() },
                  search: `#${c.number} ${c.name} ${c.topic} ${target} ${st.label}`,
                };
              })}
            />
            <CardFooter>Amounts in USDC. Paid = submitted or settled on-chain; verified = earned from accepted posts, rated discussion and attributed actions, not yet paid.</CardFooter>
          </Card>
        </>
      ) : (
        <EmptyState
          icon={<Handshake />}
          title="No creator campaigns yet"
          description={
            <span className="block text-left">
              {STEPS.map((x, i) => (
                <span key={x} className="mt-1 flex gap-2">
                  <span className="num text-ink-4">{i + 1}.</span>
                  <span>{x}</span>
                </span>
              ))}
              <span className="mt-2 block text-ink-4">v1 is built for 5–10 creators, manual review, and one tracked action. Budgets are reserved from the active mission.</span>
            </span>
          }
          action={newButton ?? <span className="text-[12px] text-ink-3">Ask an operator to start a campaign.</span>}
        />
      )}
    </div>
  );
}
