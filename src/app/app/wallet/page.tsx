import Link from "next/link";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { ArrowLeftRight, ArrowUpRight, CircleDollarSign, Layers, Lock, PiggyBank, RefreshCw, Send, ShieldCheck, Snowflake, Unlock, Wallet as WalletIcon } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { activeMission, missionSummary } from "@/server/queries/missions";
import { spentTodayMicro } from "@/server/queries/activity";
import { getWallet, walletBalances, walletIsLive } from "@/server/integrations/circle/wallets";
import { ARC, addressExplorerUrl, custodyProblem, platformCustody, txExplorerUrl } from "@/server/integrations/circle/config";
import { unifiedBalance } from "@/server/integrations/circle/appkit";
import { recentJobs } from "@/server/jobs/queue";
import { provisionWalletAction, refreshSettlementsAction, toggleFreezeAction } from "@/server/actions/wallet";
import { fmtUsdc } from "@/lib/money";
import { DAY_MS, relTime } from "@/lib/time";
import { Badge, Callout, Card, CardBody, CardFooter, CardHeader, EmptyState, ExternalLink, KeyValue, ModeBadge, PageHeader, Stat, StatStrip, StatusBadge, StatusDot, Table, shortHash } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { ActionButton } from "@/components/features/agent/action-button";
import { OnrampButton } from "@/components/features/wallet/onramp-button";
import { AttachWalletForm, DepositForm } from "@/components/features/wallet/wallet-controls";
import { LedgerExceptions } from "@/components/features/wallet/ledger-exceptions";
import { WithdrawForm } from "@/components/features/wallet/withdraw-form";
import { GAS_RESERVE_MICRO, withdrawable } from "@/server/domain/agent/withdraw";
import { effectivePaymentCeiling } from "@/server/domain/agent/policy";
import { exceptionsFor } from "@/server/domain/reconcile/exceptions";
import { balanceMicro, billingMode } from "@/server/domain/billing";
import { servicePriceMicro } from "@/lib/services";

async function attempt<T>(fn: () => Promise<T>): Promise<{ v: T | null; err: string | null }> {
  try {
    return { v: await fn(), err: null };
  } catch (e) {
    return { v: null, err: (e as Error).message.slice(0, 140) };
  }
}

const CUSTODY_LABEL: Record<string, string> = { circle_dcw: "Circle developer-controlled wallet", local_testnet: "Legacy testnet key (inactive)", unconfigured: "Not configured" };

const Code = ({ children }: { children: React.ReactNode }) => <code className="num rounded-[4px] bg-surface-3 px-1 py-px text-[11.5px] text-ink">{children}</code>;

export default async function WalletPage() {
  const { project, role, db, user } = await requireProject();
  const pid = project.id;
  const manage = can(role, "manage_wallet");
  const custody = platformCustody();
  const custodyIssue = custodyProblem();

  const [wallet, spentToday, [policy], mission, jobs, exceptions, scanCredit] = await Promise.all([
    getWallet(db, pid),
    spentTodayMicro(db, pid),
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    activeMission(db, pid),
    recentJobs(db, pid, 60),
    exceptionsFor(db, { projectId: pid, scope: "wallet", limit: 30 }),
    billingMode() === "off" ? Promise.resolve(null) : balanceMicro(db, project.ownerId),
  ]);
  const sum = mission ? await missionSummary(db, mission) : null;
  const live = walletIsLive(wallet);
  const owner = can(role, "manage_workspace");
  const address = wallet?.address ?? null;
  const [balances, ub] = await Promise.all([walletBalances(wallet), address ? attempt(() => unifiedBalance(address)) : Promise.resolve(null)]);
  const deposits = jobs.filter((j) => j.kind === "gateway_deposit").slice(0, 8);
  const canWithdraw = owner && live && !!address;
  const out = canWithdraw ? await attempt(() => withdrawable(db, pid)) : null;

  // Earn recommendation input: 7-day run rate of committed payments, including exceptions under reconciliation.
  const [rate] = await db
    .select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}),0)` })
    .from(s.transactions)
    .where(and(eq(s.transactions.projectId, pid), inArray(s.transactions.state, ["SUBMITTED", "SETTLED", "EXCEPTION"]), gte(s.transactions.createdAt, new Date(Date.now() - 7 * DAY_MS))));
  const weekly = Number(rate?.n ?? 0);

  const statusBadge = !address ? <Badge tone="warn">Not set up</Badge> : wallet?.frozen ? <Badge tone="bad" dot>Frozen</Badge> : live ? <Badge tone="good" dot>Active</Badge> : <Badge tone="warn">Cannot sign</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Wallet"
        description={`USDC operating funds on Arc. Creator payouts always require approval. Research purchases can run within the limits you enable${policy ? `; your per-payment ceiling is ${fmtUsdc(effectivePaymentCeiling(policy))}` : "; set your per-payment ceiling in Settings"}.`}
        meta={
          <>
            <ModeBadge mode={wallet?.dataMode ?? "LIVE"} />
            <span>{ARC.name}</span>
            <span className="text-ink-4">·</span>
            <span>{wallet ? CUSTODY_LABEL[wallet.provider] ?? wallet.provider : "No wallet"}</span>
          </>
        }
        actions={<ActionButton action={refreshSettlementsAction} label="Refresh settlements" icon={<RefreshCw />} />}
      />

      <StatStrip className="grid-cols-2 lg:grid-cols-4">
        <Stat label="Wallet USDC · Arc" value={balances.walletMicro != null ? fmtUsdc(balances.walletMicro, { unit: false }) : "—"} sub={!address ? "no wallet" : balances.walletMicro == null ? "RPC unreachable" : "on-chain balance"} />
        <Stat label="Gateway available" value={balances.gatewayMicro != null ? fmtUsdc(balances.gatewayMicro, { unit: false }) : "—"} sub={!address ? "no wallet" : balances.gatewayMicro == null ? "Gateway API unreachable" : "spendable via x402"} />
        <Stat label="Spent today" value={fmtUsdc(spentToday, { unit: false })} sub={`limit ${fmtUsdc(policy?.dailySpendMicro, { unit: false })} USDC`} tone={policy && spentToday >= policy.dailySpendMicro ? "warn" : undefined} />
        <Stat label="Mission remaining" value={sum && mission ? fmtUsdc(mission.budgetMicro - sum.spent, { unit: false }) : "—"} sub={sum ? `${fmtUsdc(sum.available, { unit: false })} uncommitted` : "no active mission"} />
      </StatStrip>

      {scanCredit != null && scanCredit < servicePriceMicro("scan") && (
        <Callout tone="warn" title="Scan credit is low" action={<Link href={owner ? "/billing" : "/app/team"} className="text-[12px] font-medium text-accent underline">{owner ? "Add scan credit" : "Ask workspace owner"}</Link>}>
          This wallet holds {balances.walletMicro == null ? "USDC for external payments" : fmtUsdc(balances.walletMicro)} for creator payouts and research. Market scans use a separate prepaid Billing balance, currently {fmtUsdc(scanCredit)}; each scan costs {fmtUsdc(servicePriceMicro("scan"))}. Wallet USDC is not charged automatically.
        </Callout>
      )}

      {balances.errors.length > 0 && (
        <Callout tone="warn" title="Live balance reads failed">
          {balances.errors.join(" · ")}. Nothing is shown in their place.
        </Callout>
      )}

      {custodyIssue && <Callout tone="danger" title="Circle credentials cannot operate on Arc mainnet">{custodyIssue}</Callout>}

      {wallet && wallet.blockchain !== ARC.circleBlockchain && (
        <Callout tone="danger" title="This wallet belongs to another network">
          This wallet was created on {wallet.blockchain}. It cannot sign Arc mainnet payments. Create a new workspace, then use Wallet → Create wallet on Arc mainnet there. Historical payments stay linked to this workspace. <Link href="/onboarding?new=1" className="underline">Create a new workspace</Link>
        </Callout>
      )}

      {wallet?.frozen && (
        <Callout tone="danger" title="Kill switch is on" action={manage ? <ActionButton action={toggleFreezeAction} label="Resume spending" icon={<Unlock />} size="xs" /> : undefined}>
          Every spend is denied by the policy engine until a wallet manager resumes spending.
        </Callout>
      )}

      <LedgerExceptions items={exceptions} canResolve={manage} />

      {!address ? (
        <WalletSetup custody={custody} custodyIssue={custodyIssue} manage={manage} workspaceId={pid} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader title="Workspace wallet" description="Arc mainnet EOA the agent spends from" icon={<WalletIcon />} action={statusBadge} />
              <CardBody className="space-y-4">
                <div>
                  <div className="label mb-1.5">Address</div>
                  <div className="flex items-center gap-2">
                    <CopyField value={address} className="flex-1" />
                    <a href={addressExplorerUrl(wallet!.blockchain === "ARC" ? "Arc" : "Arc_Testnet", address)} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[6px] border border-line-strong px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                      Explorer <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                </div>
                <KeyValue
                  items={[
                    { k: "Network", v: `${ARC.name} · chain ${ARC.chainId} · Gateway domain ${ARC.gatewayDomain}` },
                    { k: "Custody", v: CUSTODY_LABEL[wallet!.provider] ?? wallet!.provider },
                    ...(wallet!.circleWalletId ? [{ k: "Circle wallet ID", v: <span className="num text-[11.5px]">{wallet!.circleWalletId}</span> }] : []),
                    { k: "USDC contract", v: <ExternalLink href={addressExplorerUrl(wallet!.blockchain === "ARC" ? "Arc" : "Arc_Testnet", ARC.usdc)} className="num text-[11.5px]">{shortHash(ARC.usdc)}</ExternalLink> },
                    { k: "GatewayWallet", v: <ExternalLink href={addressExplorerUrl(wallet!.blockchain === "ARC" ? "Arc" : "Arc_Testnet", ARC.gatewayWallet)} className="num text-[11.5px]">{shortHash(ARC.gatewayWallet)}</ExternalLink> },
                    { k: "Created", v: relTime(wallet!.createdAt) },
                  ]}
                />
                {!live && (
                  <Callout tone="warn" title="This deployment can’t sign for this wallet">
                    {wallet!.blockchain !== ARC.circleBlockchain ? `This ${wallet!.blockchain} wallet cannot sign on Arc mainnet.` : `The wallet is recorded but its custody isn’t available here (${custody ? `custody is “${custody}”` : "no custody configured"}).`} Payments are disabled until an Arc mainnet Circle wallet and server credentials are configured.
                  </Callout>
                )}
              </CardBody>
              <CardFooter>
                <span className="flex items-center gap-1.5">
                  <StatusDot tone={wallet!.frozen ? "bad" : live ? "good" : "warn"} />
                  {wallet!.frozen ? "Kill switch on — every spend is denied" : live ? "Spending allowed within policy" : "Payments disabled"}
                </span>
                <Link href="/app/settings#policy" className="hover:text-ink">
                  Spend policy →
                </Link>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader title="Fund Circle Gateway" description="x402 services are paid by signature from the Gateway balance, not the wallet directly" icon={<ArrowLeftRight />} />
              <CardBody>
                {manage ? (
                  <DepositForm disabled={!live || wallet!.frozen} reason={!live ? "An Arc mainnet Circle wallet is required." : wallet!.frozen ? "The wallet is frozen." : undefined} />
                ) : (
                  <p className="text-[12.5px] text-ink-3">Only owners and admins can move treasury funds.</p>
                )}
              </CardBody>
              {deposits.length > 0 ? (
                <Table className="border-t border-line">
                  <thead>
                    <tr>
                      <th>Deposit</th>
                      <th>Status</th>
                      <th className="text-right">Attempts</th>
                      <th>Queued</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((j) => {
                      const r = (j.result ?? {}) as { depositTx?: string; approveTx?: string | null };
                      return (
                        <tr key={j.id}>
                          <td className="num">{String((j.payload as { amount?: string }).amount ?? "—")} USDC</td>
                          <td>
                            <StatusBadge status={j.status} />
                          </td>
                          <td className="num text-right text-ink-3">
                            {j.attempts}/{j.maxAttempts}
                          </td>
                          <td className="whitespace-nowrap text-ink-3">{relTime(j.createdAt)}</td>
                          <td className="max-w-[220px] truncate text-[11.5px]">
                            {r.depositTx ? (
                              <ExternalLink href={txExplorerUrl("Arc", r.depositTx)} className="num">
                                {shortHash(r.depositTx, 4)}
                              </ExternalLink>
                            ) : j.lastError ? (
                              <span className="text-critical" title={j.lastError}>
                                {j.lastError}
                              </span>
                            ) : (
                              <span className="text-ink-4">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              ) : (
                <CardFooter>No Gateway deposits yet — deposits appear here with their Arc transaction once the worker runs them.</CardFooter>
              )}
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader title="Controls" icon={<ShieldCheck />} />
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink">Kill switch</div>
                    <div className="text-[11.5px] text-ink-3">{wallet!.frozen ? "On — every spend is denied by policy" : "Off — spending allowed within policy"}</div>
                  </div>
                  {manage ? (
                    <ActionButton action={toggleFreezeAction} label={wallet!.frozen ? "Resume spending" : "Freeze spending"} icon={wallet!.frozen ? <Unlock /> : <Snowflake />} variant={wallet!.frozen ? "secondary" : "danger"} confirm={wallet!.frozen ? undefined : "Freeze all agent spending? Every spend will be denied until resumed."} />
                  ) : (
                    <Badge tone="muted">
                      <Lock className="size-3" /> Owner / admin
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink">Settlements</div>
                    <div className="text-[11.5px] text-ink-3">Poll Gateway for in-flight x402 payments</div>
                  </div>
                  <ActionButton action={refreshSettlementsAction} label="Refresh" icon={<RefreshCw />} />
                </div>
                <div className="border-t border-line pt-3">
                  <div className="mb-2 text-[12.5px] font-medium text-ink">Add budget</div>
                  {process.env.ONRAMP_API_KEY ? (
                    <OnrampButton address={address} userId={user.id} disabled={!manage} />
                  ) : (
                    <p className="text-[11.5px] text-ink-3">
                      Arc Onramp is optional — set <Code>ONRAMP_API_KEY</Code> to buy USDC straight into this wallet. Otherwise transfer Arc mainnet USDC to the wallet address above.
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>

            {canWithdraw && (
              <Card>
                <CardHeader title="Withdraw USDC" description="Move your money out of this workspace wallet to any Arc address you control" icon={<ArrowUpRight />} />
                <CardBody>
                  {out?.v ? (
                    <>
                      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
                        Available now <span className="num text-ink">{fmtUsdc(out.v.availableMicro)}</span> — the wallet balance{out.v.inFlightMicro ? `, minus ${fmtUsdc(out.v.inFlightMicro)} committed to payments in progress,` : ""} minus {fmtUsdc(GAS_RESERVE_MICRO)} kept for Arc&apos;s network fee. Owner only; every withdrawal is confirmed with a code we email you, recorded with a receipt and checked on Arc.
                      </p>
                      {wallet!.frozen ? <Callout tone="warn">Resume spending above before withdrawing.</Callout> : <WithdrawForm availableUsdc={(Math.floor(out.v.availableMicro / 10_000) / 100).toFixed(2)} explorer={ARC.explorer} />}
                    </>
                  ) : (
                    <p className="text-[12.5px] text-ink-3">Couldn&apos;t read the wallet balance from Arc right now: {out?.err ?? "—"}</p>
                  )}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Gateway balance on Arc" description="Available USDC reported through Circle" icon={<Layers />} />
              <CardBody>
                {ub?.v ? (
                  <>
                    <div className="num text-[24px] font-medium tracking-[-0.03em]">{fmtUsdc(ub.v.totalMicro)}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">Available Gateway capital on Arc</div>
                    {ub.v.byChain.length > 0 && (
                      <KeyValue className="mt-3" items={ub.v.byChain.map((c) => ({ k: c.label, v: <span className="num">{fmtUsdc(c.micro)}</span> }))} />
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px] text-ink-3">Unavailable: {ub?.err ?? "—"}</p>
                )}
              </CardBody>
            </Card>

            <AppKitCard />
            <BudgetPlanCard weekly={weekly} available={sum?.available ?? null} />
          </div>
        </div>
      )}

      {!address && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AppKitCard />
          <BudgetPlanCard weekly={weekly} available={sum?.available ?? null} />
        </div>
      )}
    </div>
  );
}

function WalletSetup({ custody, custodyIssue, manage, workspaceId }: { custody: "circle" | null; custodyIssue: string | null; manage: boolean; workspaceId: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader title="Create the workspace wallet" description="Each workspace gets its own Arc mainnet wallet — the agent’s operating budget" icon={<WalletIcon />} action={<Badge tone="warn">Not set up</Badge>} />
        <CardBody className="space-y-4">
          {custody === "circle" ? (
            <Callout tone="info" title="Circle developer-controlled wallets">
              Keys live in Circle’s custody. GrowTendril holds only the API key and entity secret, server-side, and creates a dedicated EOA on ARC for this workspace.
            </Callout>
          ) : (
            <Callout tone="danger" title="No custody configured on this deployment">
              {custodyIssue ?? <>Set <Code>CIRCLE_API_KEY</Code> and <Code>CIRCLE_ENTITY_SECRET</Code> in the server environment to create Circle developer-controlled wallets.</>} Payments remain disabled until then.
            </Callout>
          )}
          {manage ? (
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton action={provisionWalletAction} label="Create wallet on Arc mainnet" icon={<CircleDollarSign />} variant="primary" disabled={!custody} />
              <span className="text-[11.5px] text-ink-3">{custody ? "Takes a few seconds. Fund with Arc mainnet USDC afterwards." : "Enabled once custody is configured."}</span>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-3">Ask a workspace owner or admin to create the wallet.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Attach an existing Circle wallet" description="A live Arc mainnet EOA registered to this workspace in Circle." icon={<ArrowLeftRight />} />
        <CardBody>
          {manage ? (
            custody === "circle" ? (
              <AttachWalletForm workspaceId={workspaceId} />
            ) : (
              <p className="text-[12.5px] text-ink-3">
                Attaching needs Circle credentials on the server (<Code>CIRCLE_API_KEY</Code>, <Code>CIRCLE_ENTITY_SECRET</Code>).
              </p>
            )
          ) : (
            <p className="text-[12.5px] text-ink-3">Only owners and admins can attach wallets.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function AppKitCard() {
  const caps = [
    { icon: <Send />, label: "Send", detail: "USDC transfers on Arc — used for creator payouts after policy and approval." },
    { icon: <ArrowLeftRight />, label: "Bridge", detail: "Off for the mainnet launch — the policy engine refuses cross-chain transfers, so funds stay on Arc." },
    { icon: <Layers />, label: "Gateway balance", detail: "Read available USDC in Circle Gateway on Arc." },
  ];
  return (
    <Card>
      <CardHeader title="Payment capabilities" description="Transfers follow your spending rules and approval requirements." />
      <ul className="divide-y divide-line">
        {caps.map((c) => (
          <li key={c.label} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-ink-3 ring-1 ring-line [&_svg]:size-3.5">{c.icon}</span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink">{c.label}</span>
              <span className="block text-[11.5px] leading-snug text-ink-3">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BudgetPlanCard({ weekly, available }: { weekly: number; available: number | null }) {
  return (
    <Card>
      <CardHeader title="Mission budget and payments" description="Planning limits, separate from the wallet balance" icon={<PiggyBank />} action={<Badge tone="muted">Budget</Badge>} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <Stat size="sm" label="Payments in 7 days" value={fmtUsdc(weekly, { unit: false })} sub="USDC submitted or settled" />
          <Stat size="sm" label="Uncommitted mission budget" value={fmtUsdc(available, { unit: false })} sub={available == null ? "no active mission" : "USDC within the mission ceiling"} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-2">
          The mission budget limits how much the operator may commit. It does not add funds to the wallet; check the live wallet and Gateway balances before funding payments.
        </p>
      </CardBody>
    </Card>
  );
}
