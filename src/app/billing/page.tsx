import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, Coins, Receipt, RotateCcw, Sparkles } from "lucide-react";
import { requireUser } from "@/server/auth/current";
import { getDb, schema as s } from "@/server/db/client";
import { logoutAction } from "@/server/actions/auth";
import { billingMode, billingSummary, invoicesFor, ledgerFor } from "@/server/domain/billing";
import { nextStep } from "@/server/auth/next-step";
import { txExplorerUrl } from "@/server/integrations/circle/config";
import { fmtUsdc } from "@/lib/money";
import { relTime } from "@/lib/time";
import { SERVICE_KEYS, SERVICES, servicePriceMicro, type ServiceKey } from "@/lib/services";
import { Badge, Callout, Card, CardBody, CardHeader, LinkButton, Table, cn } from "@/components/ui";
import { CountUp } from "@/components/ui/count-up";
import { Logo, LogoMark } from "@/components/layout/logo";
import { TopUpButton, TopUpForm } from "@/components/features/billing/top-up";

export const dynamic = "force-dynamic";

const exactUsdc = (micro: number) => (micro / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

const KIND: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  topup: { label: "Top-up", icon: <ArrowDownLeft />, tone: "text-good" },
  charge: { label: "Charge", icon: <ArrowUpRight />, tone: "text-ink" },
  refund: { label: "Refund", icon: <RotateCcw />, tone: "text-good" },
};

export default async function Billing() {
  const user = await requireUser();
  const db = await getDb();
  const mode = billingMode();
  const [summary, ledger, invoices, next, ownedWorkspaces] = await Promise.all([
    billingSummary(db, user.id), ledgerFor(db, user.id, 100), invoicesFor(db, user.id, 24), nextStep(db, user.id, null),
    db.select({ id: s.projects.id, name: s.projects.name, autopilot: s.projects.autopilot }).from(s.projects).where(eq(s.projects.ownerId, user.id)),
  ]);
  const balance = summary.balanceMicro;
  const projectIds = [...new Set(ledger.map((l) => l.projectId).filter((x): x is string => !!x))];
  const names = new Map(projectIds.length ? (await db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).where(inArray(s.projects.id, projectIds))).map((p) => [p.id, p.name]) : []);
  const owned = ownedWorkspaces[0];
  const scheduledWorkspaces = ownedWorkspaces.filter((p) => p.autopilot !== "off");
  const pending = invoices.find((i) => i.status === "pending" && i.expiresAt.getTime() > Date.now());
  const paid = invoices.filter((i) => i.status === "paid");
  const scans = Math.floor(balance / servicePriceMicro("scan"));
  const topupIndex = ledger.findIndex((l) => l.kind === "topup");
  const latestTopup = topupIndex >= 0 ? ledger[topupIndex] : null;
  const afterTopup = topupIndex >= 0 ? ledger.slice(0, topupIndex) : [];
  const correctedScan = afterTopup.find((l) => l.kind === "refund" && l.service === "scan" && l.note?.startsWith("Credit restored: Quick Start"));
  const latestCharge = afterTopup.find((l) => l.kind === "charge" && !afterTopup.some((r) => r.kind === "refund" && r.ref === l.ref));

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface/60 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/" aria-label="GrowTendril home">
            <Logo grow />
          </Link>
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <span className="hidden sm:inline">{user.email}</span>
            <LinkButton href={next} size="sm" variant="ghost">
              {next === "/onboarding" ? "Set up workspace" : "Back to app"}
            </LinkButton>
            <form action={logoutAction}>
              <button type="submit" className="hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="app-main mx-auto max-w-4xl px-4 py-8">
        <div className="space-y-5">
          <div>
            <h1 className="display display-bounce text-[clamp(1.9rem,3.2vw,2.5rem)] leading-tight text-ink">Billing &amp; credit</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              Top up USDC on Arc once, then pay only for what runs. Each service has one fixed price, taken from your balance when it runs — whoever on your team starts it. Browsing, settings, team and exports are free.
            </p>
            {mode !== "off" && <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">Scan credit is separate from your workspace wallet. To use wallet USDC for a scan, create a 2 USDC invoice here and choose &ldquo;Pay from workspace wallet&rdquo; on its payment page. You approve the transfer by email, and credit is added after Arc confirms it.</p>}
          </div>

          {mode === "off" && (
            <Callout tone="info" title="Billing isn't enabled on this deployment">
              Every service is free here.{" "}
              <Link href={next} className="underline">
                Continue to GrowTendril
              </Link>
            </Callout>
          )}
          {mode === "dev" && (
            <Callout tone="warn" title="Development billing">
              No billing address is configured, so &ldquo;Add credit&rdquo; adds it without a payment. This never appears in production.
            </Callout>
          )}
          {pending && (
            <Callout tone="info" title="You have an unfinished top-up" action={<LinkButton href={`/billing/pay/${pending.id}`} size="sm" variant="primary">Continue paying</LinkButton>}>
              {fmtUsdc(pending.priceMicro)} — send exactly <span className="num">{(pending.amountMicro / 1e6).toFixed(6)}</span> USDC on Arc. Expires {relTime(pending.expiresAt)}.
            </Callout>
          )}
          {scheduledWorkspaces.length > 0 && mode === "arc" && (
            <Callout tone="warn" title="Autopilot can use new credit automatically" action={<LinkButton href="/app/settings#autopilot" size="sm" variant="secondary">Autopilot settings</LinkButton>}>
              {scheduledWorkspaces.map((p) => p.name).join(", ")} {scheduledWorkspaces.length === 1 ? "has" : "have"} Autopilot enabled. A due market scan may start as soon as your top-up settles and use 2 USDC. Pause Autopilot before paying if you want to run the scan yourself.
            </Callout>
          )}
          {latestTopup && latestCharge && balance < servicePriceMicro("scan") && (
            <Callout tone="info" title={latestCharge.note === "Autopilot scan" ? "Your top-up funded an Autopilot scan" : "Your top-up funded a service"} action={<LinkButton href="/app/runs" size="sm" variant="secondary">View runs</LinkButton>}>
              {exactUsdc(latestTopup.amountMicro)} USDC was added to your credit, then {exactUsdc(-latestCharge.amountMicro)} USDC was charged for {latestCharge.note === "Autopilot scan" ? "a scheduled scan" : latestCharge.service ?? "a service"}. Your exact current balance is {exactUsdc(balance)} USDC.
            </Callout>
          )}
          {correctedScan && (
            <Callout tone="success" title="Your scan credit was restored" action={<LinkButton href="/app/discover" size="sm" variant="primary">Run a scan</LinkButton>}>
              {exactUsdc(correctedScan.amountMicro)} USDC was returned to your credit after a scan started by the Quick Start Autopilot default. Your exact current balance is {exactUsdc(balance)} USDC. {ownedWorkspaces.find((p) => p.id === correctedScan.projectId)?.autopilot === "off" ? "Autopilot is paused for this workspace." : "Review your Autopilot setting before adding more credit."}
            </Callout>
          )}

          <div className="grid gap-4 md:grid-cols-[1fr_1.15fr]">
            <div className="sky-soft relative rounded-[22px] border border-line p-6 shadow-[var(--shadow-card)]">
              <LogoMark size={170} sway className="pointer-events-none absolute -bottom-8 -right-6 text-accent opacity-[0.1]" />
              <div className="relative">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
                  <Coins className="size-4" /> Balance
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className={cn("display text-[clamp(2rem,5vw,3.5rem)] leading-none", balance > 0 ? "text-ink" : "text-ink-3")}>
                    <CountUp text={exactUsdc(balance)} />
                  </span>
                  <span className="num text-[14px] text-ink-3">USDC</span>
                </div>
                <p className="mt-3 text-[12.5px] text-ink-3">
                  {mode === "off" ? "Not needed while billing is off." : balance > 0 ? <>Enough for <span className="num text-ink-2">{scans}</span> market scan{scans === 1 ? "" : "s"}.</> : "Top up to start running scans and reports."}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[12px]">
                  <div>
                    <div className="text-ink-3">Spent so far</div>
                    <div className="num mt-0.5 text-[15px] text-ink">{fmtUsdc(Math.max(0, summary.spentMicro), { unit: false })}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Top-ups</div>
                    <div className="num mt-0.5 text-[15px] text-ink">{summary.topups}</div>
                  </div>
                </div>
              </div>
            </div>

            <Card>
              <CardHeader title="Add credit" description={mode === "arc" ? "Pay in USDC on Arc — settles in about a second." : "Choose an amount."} icon={<Sparkles />} />
              <CardBody>
                {mode === "off" ? <p className="text-[12.5px] text-ink-3">Nothing to pay while billing is off.</p> : <div className="space-y-3"><TopUpForm mode={mode} suggested={balance === 0 ? 10 : undefined} />{mode === "arc" && owned && balance < servicePriceMicro("scan") && <TopUpButton usdc={2} mode="arc" label="Fund one scan from wallet" />}</div>}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="What each service costs" description="Fixed prices. A service that fails is refunded automatically." icon={<Receipt />} />
            <ul className="divide-y divide-line">
              {SERVICE_KEYS.map((k) => (
                <li key={k} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink">{SERVICES[k].name}</div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{SERVICES[k].blurb}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[16px] font-medium text-ink">{SERVICES[k].priceUsdc} USDC</div>
                    <div className="text-[11px] text-ink-4">{SERVICES[k].unit}</div>
                  </div>
                </li>
              ))}
              <li className="flex items-center justify-between gap-4 px-5 py-3 text-[12px] text-ink-3">
                <span>Workspaces, browsing evidence, the growth plan, settings, team and exports</span>
                <Badge tone="good">Free</Badge>
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent activity" description="Latest 100 top-ups, charges and refunds. Balance and totals include your full history." />
            {ledger.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Workspace</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l) => {
                    const k = KIND[l.kind] ?? KIND.charge;
                    return (
                      <tr key={l.id}>
                        <td className="num whitespace-nowrap text-ink-3" title={l.createdAt.toLocaleString()}>
                          {relTime(l.createdAt)}
                        </td>
                        <td>
                          <span className="flex items-center gap-2">
                            <span className={cn("[&_svg]:size-3.5", k.tone)}>{k.icon}</span>
                            <span className="text-ink">{l.service ? SERVICES[l.service as ServiceKey]?.name ?? l.service : k.label}</span>
                            {l.kind !== "charge" && l.service && <Badge tone="good">{k.label}</Badge>}
                            {l.note && <span className="text-ink-4">· {l.note}</span>}
                          </span>
                        </td>
                        <td className="text-ink-3">{l.projectId ? names.get(l.projectId) ?? "—" : "—"}</td>
                        <td className={cn("num whitespace-nowrap text-right", l.amountMicro > 0 ? "text-good" : "text-ink")}>
                          {l.amountMicro > 0 ? "+" : "−"}
                          {fmtUsdc(Math.abs(l.amountMicro), { unit: false })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">Nothing yet. {owned ? "Top up, then run a market scan from your workspace." : "Set up a workspace, then top up to run its first scan."}</CardBody>
            )}
          </Card>

          {paid.length > 0 && (
            <Card>
              <CardHeader title="Recent payments on Arc" description="The latest invoices and their USDC transfers on Arc." />
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Amount</th>
                    <th>From</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((i) => (
                    <tr key={i.id}>
                      <td className="num">{i.paidAt ? i.paidAt.toLocaleDateString() : "—"}</td>
                      <td className="num text-right">{((i.paidMicro ?? i.amountMicro) / 1e6).toFixed(6)} USDC</td>
                      <td className="num text-[11.5px] text-ink-3">{i.payer ? `${i.payer.slice(0, 8)}…${i.payer.slice(-4)}` : "—"}</td>
                      <td>
                        {i.txHash && (
                          <a href={txExplorerUrl(i.chain, i.txHash)} target="_blank" rel="noreferrer" className="num text-[11.5px] underline">
                            {i.txHash.slice(0, 10)}…
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <p className="text-center text-[11.5px] text-ink-4">
            Top-ups go straight to GrowTendril&apos;s Arc address and are checked on-chain; GrowTendril never holds your keys. Receipts are emailed to {user.email}. Credit is charged to the account that owns a workspace; teammates you invite use the owner&apos;s balance.
          </p>
        </div>
      </div>
    </div>
  );
}
