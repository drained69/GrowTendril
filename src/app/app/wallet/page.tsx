import Link from "next/link";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { ArrowLeftRight, ArrowUpRight, CircleDollarSign, Layers, Lock, PiggyBank, RefreshCw, Send, ShieldCheck, Snowflake, Unlock, Wallet as WalletIcon } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { activeMission, missionSummary } from "@/server/queries/missions";
import { spentTodayMicro } from "@/server/queries/activity";
import { getWallet, walletBalances, walletIsLive } from "@/server/integrations/circle/wallets";
import { ACTIVE_CHAINS, ARC, IS_MAINNET, addressExplorerUrl, chainLabel, platformCustody, txExplorerUrl } from "@/server/integrations/circle/config";
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

async function attempt<T>(fn: () => Promise<T>): Promise<{ v: T | null; err: string | null }> {
  try {
    return { v: await fn(), err: null };
  } catch (e) {
    return { v: null, err: (e as Error).message.slice(0, 140) };
  }
}

const CUSTODY_LABEL: Record<string, string> = { circle_dcw: "Circle developer-controlled wallet", local_testnet: "Server-side development key (testnet)", unconfigured: "Not configured" };

const Code = ({ children }: { children: React.ReactNode }) => <code className="num rounded-[4px] bg-surface-3 px-1 py-px text-[11.5px] text-ink">{children}</code>;

export default async function WalletPage() {
  const { project, role, db, user } = await requireProject();
  const pid = project.id;
  const demo = project.dataMode === "DEMO";
  const manage = can(role, "manage_wallet");
  // Anyone who manages the wallet may freeze it; on mainnet only an owner may resume spending.
  const canResume = manage && (!IS_MAINNET || role === "owner");
  const custody = platformCustody();

  const [wallet, spentToday, [policy], mission, jobs] = await Promise.all([
    getWallet(db, pid),
    spentTodayMicro(db, pid),
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    activeMission(db, pid),
    recentJobs(db, pid, 60),
  ]);
  const sum = mission ? await missionSummary(db, mission) : null;
  const live = walletIsLive(wallet);
  const address = wallet?.address ?? null;
  const [balances, ub] = await Promise.all([walletBalances(wallet), address ? attempt(() => unifiedBalance(address)) : Promise.resolve(null)]);
  const deposits = jobs.filter((j) => j.kind === "gateway_deposit").slice(0, 8);
  const depositTxIds = deposits.map((j) => String((j.payload as { transactionId?: string }).transactionId ?? "")).filter(Boolean);
  const depositChain = new Map(
    depositTxIds.length ? (await db.select({ id: s.transactions.id, chain: s.transactions.chain }).from(s.transactions).where(inArray(s.transactions.id, depositTxIds))).map((r) => [r.id, r.chain]) : [],
  );

  // Earn recommendation input: 7-day run rate of spend that actually moved (or would have).
  // Treasury moves (Gateway deposits, bridges) are our own funds changing place, not spend.
  const [rate] = await db
    .select({ n: sql<string>`coalesce(sum(${s.transactions.amountMicro}),0)` })
    .from(s.transactions)
    .where(and(eq(s.transactions.projectId, pid), inArray(s.transactions.state, ["SUBMITTED", "SETTLED", "SIMULATED"]), ne(s.transactions.budgetCategory, "treasury"), gte(s.transactions.createdAt, new Date(Date.now() - 7 * DAY_MS))));
  const weekly = Number(rate?.n ?? 0);
  // Idle = funds actually held (wallet + Gateway) beyond two weeks of run-rate; unknown if a balance read failed.
  const held = balances.walletMicro != null && balances.gatewayMicro != null ? balances.walletMicro + balances.gatewayMicro : null;
  const idle = held != null ? Math.max(0, held - weekly * 2) : null;

  const statusBadge = !address ? <Badge tone="warn">Not set up</Badge> : wallet?.frozen ? <Badge tone="bad" dot>Frozen</Badge> : live ? <Badge tone="good" dot>Active</Badge> : <Badge tone="warn">Cannot sign</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Wallet"
        description="The agent’s operating budget. Keys never reach the AI: Circle custodies them (developer-controlled wallet) or, in development-key mode (testnet only), they stay in server env and only sign through the policy engine."
        meta={
          <>
            <ModeBadge mode={wallet?.dataMode ?? (demo ? "DEMO" : "SIMULATED")} />
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
        <Stat label="Mission budget left" value={sum && mission ? fmtUsdc(mission.budgetMicro - sum.spent, { unit: false }) : "—"} sub={sum ? `budget, not funds · ${fmtUsdc(sum.available, { unit: false })} uncommitted` : "no active mission"} />
      </StatStrip>

      {balances.errors.length > 0 && (
        <Callout tone="warn" title="Live balance reads failed">
          {balances.errors.join(" · ")}. Nothing is shown in their place.
        </Callout>
      )}

      {wallet?.frozen && (
        <Callout tone="danger" title="Kill switch is on" action={canResume ? <ActionButton action={toggleFreezeAction} label="Resume spending" icon={<Unlock />} size="xs" /> : undefined}>
          Every spend is denied by the policy engine until {IS_MAINNET ? "a workspace owner" : "a wallet manager"} resumes spending.
        </Callout>
      )}

      {!address ? (
        <WalletSetup custody={custody} manage={manage} demo={demo} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Workspace wallet" description={`${ARC.name} EOA the agent spends from`} icon={<WalletIcon />} action={statusBadge} />
              <CardBody className="space-y-4">
                <div>
                  <div className="label mb-1.5">Address</div>
                  <div className="flex items-center gap-2">
                    <CopyField value={address} className="flex-1" />
                    <a href={addressExplorerUrl(ARC.appKitChain, address)} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[6px] border border-line-strong px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                      Explorer <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                </div>
                <KeyValue
                  items={[
                    { k: "Network", v: `${ARC.name} · chain ${ARC.chainId} · Gateway domain ${ARC.gatewayDomain}` },
                    { k: "Custody", v: CUSTODY_LABEL[wallet!.provider] ?? wallet!.provider },
                    ...(wallet!.circleWalletId ? [{ k: "Circle wallet ID", v: <span className="num text-[11.5px]">{wallet!.circleWalletId}</span> }] : []),
                    { k: "USDC contract", v: <ExternalLink href={addressExplorerUrl(ARC.appKitChain, ARC.usdc)} className="num text-[11.5px]">{shortHash(ARC.usdc)}</ExternalLink> },
                    { k: "GatewayWallet", v: <ExternalLink href={addressExplorerUrl(ARC.appKitChain, ARC.gatewayWallet)} className="num text-[11.5px]">{shortHash(ARC.gatewayWallet)}</ExternalLink> },
                    { k: "Created", v: relTime(wallet!.createdAt) },
                  ]}
                />
                {!live && (
                  <Callout tone="warn" title="This deployment can’t sign for this wallet">
                    The wallet is recorded but its custody isn’t available here ({custody ? `custody is “${custody}”` : "no custody configured"}). Payments fall back to SIMULATED until <Code>CIRCLE_API_KEY</Code> and <Code>CIRCLE_ENTITY_SECRET</Code> are set.
                  </Callout>
                )}
              </CardBody>
              <CardFooter>
                <span className="flex items-center gap-1.5">
                  <StatusDot tone={wallet!.frozen ? "bad" : live ? "good" : "warn"} />
                  {wallet!.frozen ? "Kill switch on — every spend is denied" : live ? "Spending allowed within policy" : "Simulation only"}
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
                  <DepositForm networkName={ARC.name} disabled={!live || wallet!.frozen || demo} reason={demo ? "Demo workspaces run in simulation — create a real workspace to deposit." : !live ? "The wallet can’t sign on this deployment." : wallet!.frozen ? "The wallet is frozen." : undefined} />
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
                              <ExternalLink href={txExplorerUrl(depositChain.get(String((j.payload as { transactionId?: string }).transactionId)) ?? ARC.appKitChain, r.depositTx)} className="num">
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

          <div className="space-y-4">
            <Card>
              <CardHeader title="Controls" icon={<ShieldCheck />} />
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink">Kill switch</div>
                    <div className="text-[11.5px] text-ink-3">{wallet!.frozen ? "On — every spend is denied by policy" : "Off — spending allowed within policy"}</div>
                  </div>
                  {manage && (!wallet!.frozen || canResume) ? (
                    <ActionButton action={toggleFreezeAction} label={wallet!.frozen ? "Resume spending" : "Freeze spending"} icon={wallet!.frozen ? <Unlock /> : <Snowflake />} variant={wallet!.frozen ? "secondary" : "danger"} confirm={wallet!.frozen ? undefined : "Freeze all agent spending? Every spend will be denied until resumed."} />
                  ) : (
                    <Badge tone="muted">
                      <Lock className="size-3" /> {wallet!.frozen && IS_MAINNET ? "Owner" : "Owner / admin"}
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
                  {process.env.ONRAMP_API_KEY && IS_MAINNET && !demo ? (
                    <OnrampButton address={address} userId={user.id} disabled={!manage} />
                  ) : (
                    <p className="text-[11.5px] text-ink-3">
                      {IS_MAINNET ? (
                        <>
                          Arc Onramp is optional — set <Code>ONRAMP_API_KEY</Code> to buy USDC on {ARC.name} straight into this wallet.{" "}
                        </>
                      ) : (
                        <>Arc Onramp delivers mainnet USDC, so it is off on {ARC.name}. </>
                      )}
                      {ARC.faucet ? (
                        <>
                          Fund it from <ExternalLink href={ARC.faucet}>faucet.circle.com</ExternalLink>.
                        </>
                      ) : (
                        <>Otherwise send USDC on {ARC.name} to the address above.</>
                      )}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Unified balance" description="Gateway balance across chains, via App Kit" icon={<Layers />} />
              <CardBody>
                {ub?.v ? (
                  <>
                    <div className="num text-[24px] font-medium tracking-[-0.03em]">{fmtUsdc(ub.v.totalMicro)}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">Available growth capital across chains</div>
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
            <EarnCard weekly={weekly} idle={idle} />
          </div>
        </div>
      )}

      {!address && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AppKitCard />
          <EarnCard weekly={weekly} idle={idle} />
        </div>
      )}
    </div>
  );
}

function WalletSetup({ custody, manage, demo }: { custody: "circle" | "local" | null; manage: boolean; demo: boolean }) {
  if (demo)
    return (
      <EmptyState
        icon={<WalletIcon />}
        title="Demo workspaces run in simulation"
        description={`Every payment in the demo is labelled SIMULATED or DEMO — no funds move. Create a real workspace to provision an ${ARC.name} wallet.`}
      />
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader title="Create the workspace wallet" description={`Each workspace gets its own ${ARC.name} wallet — the agent’s operating budget`} icon={<WalletIcon />} action={<Badge tone="warn">Not set up</Badge>} />
        <CardBody className="space-y-4">
          {custody === "circle" ? (
            <Callout tone="info" title="Circle developer-controlled wallets">
              Keys live in Circle’s custody. GrowTendril holds only the API key and entity secret, server-side, and creates a dedicated EOA on {ARC.circleBlockchain} for this workspace.
            </Callout>
          ) : custody === "local" ? (
            <Callout tone="warn" title="Development key (testnet only)">
              This deployment signs with a single server-side development key (<Code>AGENT_PRIVATE_KEY</Code>). It is never sent to the browser or the LLM, and is refused outside testnet. Use Circle custody for anything shared.
            </Callout>
          ) : (
            <Callout tone="danger" title="No custody configured on this deployment">
              Set <Code>CIRCLE_API_KEY</Code> and <Code>CIRCLE_ENTITY_SECRET</Code> in the server environment to create Circle developer-controlled wallets. Until then, every payment runs as SIMULATED and moves nothing.
            </Callout>
          )}
          {manage ? (
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton action={provisionWalletAction} label={`Create wallet on ${ARC.name}`} icon={<CircleDollarSign />} variant="primary" disabled={!custody} />
              <span className="text-[11.5px] text-ink-3">{custody ? (ARC.faucet ? "Takes a few seconds. Fund it afterwards from faucet.circle.com." : "Takes a few seconds. It starts frozen: fund it with USDC on Arc, review the spend policy, then an owner resumes spending.") : "Enabled once custody is configured."}</span>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-3">Ask a workspace owner or admin to create the wallet.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Attach an existing Circle wallet" description={`Already have an ${ARC.circleBlockchain} developer-controlled wallet?`} icon={<ArrowLeftRight />} />
        <CardBody>
          {manage ? (
            custody === "circle" ? (
              <AttachWalletForm blockchain={ARC.circleBlockchain} />
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
    { icon: <Send />, label: "Send", detail: `USDC transfers on ${ARC.name} — used for creator payouts after policy and approval.` },
    { icon: <ArrowLeftRight />, label: "Bridge", detail: `Available through the policy engine for ${ACTIVE_CHAINS.map(chainLabel).join(", ")} (CCTP) — not used by the agent yet.` },
    { icon: <Layers />, label: "Unified balance", detail: "Read one Gateway balance across chains (read-only, no signing)." },
  ];
  return (
    <Card>
      <CardHeader title="App Kit capabilities" description="Every call goes through Zod → policy engine → (approval) first" />
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

function EarnCard({ weekly, idle }: { weekly: number; idle: number | null }) {
  return (
    <Card>
      <CardHeader title="Idle funds · Earn" description="Recommendation only — never executed" icon={<PiggyBank />} action={<Badge tone="muted">Advisory</Badge>} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <Stat size="sm" label="7-day run-rate" value={fmtUsdc(weekly, { unit: false })} sub="USDC spent, excl. treasury moves" />
          <Stat size="sm" label="Idle beyond 2 weeks" value={idle != null ? fmtUsdc(idle, { unit: false }) : "—"} sub={idle != null ? "wallet + Gateway balance" : "balances unavailable"} tone={idle != null && idle >= 1_000_000_000 ? "good" : undefined} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-2">
          {idle == null ? "Needs live wallet and Gateway balances." : idle >= 1_000_000_000 ? "GrowTendril would recommend placing part of this in a supported App Kit Earn vault — only with explicit founder approval." : "Not enough idle capital to justify moving funds."}
        </p>
        <p className="text-[11.5px] leading-relaxed text-ink-3">GrowTendril never makes yield decisions autonomously; Circle’s Earn Kit is marked “coming soon”, so execution is not enabled in this build. Borrow is intentionally not built.</p>
      </CardBody>
    </Card>
  );
}
