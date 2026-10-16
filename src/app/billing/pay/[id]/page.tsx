import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { currentProject, requireUser } from "@/server/auth/current";
import { getDb, schema as s } from "@/server/db/client";
import { logoutAction } from "@/server/actions/auth";
import { balanceMicro, billingMode } from "@/server/domain/billing";
import { fmtUsdc } from "@/lib/money";
import { nextStep } from "@/server/auth/next-step";
import { ARC, txExplorerUrl } from "@/server/integrations/circle/config";
import { relTime } from "@/lib/time";

/** "in 1h 59m" — relTime rounds hours down, which made a 2-hour invoice read "in 1h". */
const untilLabel = (d: Date) => {
  const m = Math.max(0, Math.round((d.getTime() - Date.now()) / 60_000));
  return m >= 60 ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `in ${m}m`;
};
import { Badge, Callout, Card, CardBody, CardHeader, KeyValue, LinkButton } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { Logo } from "@/components/layout/logo";
import { PayInvoice } from "@/components/features/billing/pay-invoice";
import { PayWorkspaceWallet } from "@/components/features/billing/pay-workspace-wallet";
import { TopUpButton } from "@/components/features/billing/top-up";
import { withdrawable } from "@/server/domain/agent/withdraw";
import { servicePriceMicro } from "@/lib/services";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";

export const dynamic = "force-dynamic";

/** Pay one invoice in USDC on Arc: exact amount, billing address, wallet button, or a transaction hash. */
export default async function PayInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = await getDb();
  const [inv] = await db.select().from(s.billingInvoices).where(and(eq(s.billingInvoices.id, id), eq(s.billingInvoices.userId, user.id)));
  if (!inv) notFound();
  const expired = inv.status === "expired" || (inv.status === "pending" && inv.expiresAt.getTime() < Date.now());
  const amount = (inv.amountMicro / 1e6).toFixed(6);
  const next = await nextStep(db, user.id, null);
  const balance = inv.status === "paid" ? await balanceMicro(db, user.id) : 0;
  const scheduled = inv.status === "pending" ? await db.select({ name: s.projects.name }).from(s.projects).where(and(eq(s.projects.ownerId, user.id), ne(s.projects.autopilot, "off"))) : [];
  const paymentNext = inv.priceMicro === servicePriceMicro("scan") ? "/app/discover" : "/billing";
  const selected = await currentProject(user.id);
  const walletOwner = selected?.project.ownerId === user.id && !expired && inv.status === "pending";
  const workspaceWallet = walletOwner ? await getWallet(db, selected.project.id) : null;
  const walletFunds = walletOwner && workspaceWallet && walletIsLive(workspaceWallet) && !workspaceWallet.frozen
    ? await withdrawable(db, selected.project.id).catch(() => null) : null;
  const walletUnavailable = walletOwner && !walletFunds
    ? workspaceWallet?.frozen ? "Workspace spending is frozen. Resume it on the Wallet page to pay this invoice." : walletIsLive(workspaceWallet) ? "Couldn't read the workspace wallet balance right now. Try refreshing this page." : "Create or attach an Arc mainnet workspace wallet to pay from it."
    : null;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            <Link href="/billing" className="hover:text-ink">
              Back to billing
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <div>
          <h1 className="display text-[28px] leading-tight text-ink">Pay with USDC on Arc</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Top up {fmtUsdc(inv.priceMicro)} of credit · settles in about a second on Arc. The full amount you send is added to your balance.
          </p>
        </div>

        {inv.status === "paid" ? (
          <Card>
            <CardHeader title="Paid" description={inv.paidAt ? `Confirmed ${relTime(inv.paidAt)}` : undefined} action={<Badge tone="good">Paid</Badge>} />
            <CardBody className="space-y-3 text-[12.5px] text-ink-2">
              <KeyValue
                items={[
                  { k: "Amount paid", v: <span className="num">{((inv.paidMicro ?? inv.amountMicro) / 1e6).toFixed(6)} USDC</span> },
                  { k: "Balance now", v: <span className="num">{fmtUsdc(balance)}</span> },
                  {
                    k: "Transaction",
                    v: inv.txHash ? (
                      <a href={txExplorerUrl(inv.chain, inv.txHash)} target="_blank" rel="noreferrer" className="num underline">
                        {inv.txHash.slice(0, 12)}…{inv.txHash.slice(-6)}
                      </a>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
              <LinkButton href={next} variant="primary">Continue to app</LinkButton>
              <LinkButton href="/app/discover" variant="secondary">Run a scan</LinkButton>
            </CardBody>
          </Card>
        ) : expired ? (
          <Card>
            <CardBody className="space-y-4">
              <Callout tone="warn" title="This invoice expired">
                Invoices last 2 hours so a payment can be matched to you. If you already sent USDC for it, paste the transaction hash on a new invoice and it still counts.
              </Callout>
              {billingMode() === "arc" && <TopUpButton usdc={inv.priceMicro / 1e6} mode="arc" label="Create a new invoice" />}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title={`Send exactly ${amount} USDC`} description={`Expires ${untilLabel(inv.expiresAt)}. The last digits identify your payment.`} action={<Badge tone="info">Waiting</Badge>} />
            <CardBody className="space-y-4">
              <div>
                <div className="label mb-1.5">Amount (USDC)</div>
                <CopyField value={amount} />
              </div>
              <div>
                <div className="label mb-1.5">To this address</div>
                <CopyField value={inv.payTo} />
              </div>
              <KeyValue
                items={[
                  { k: "Network", v: `Arc Mainnet (chain ${ARC.chainId})` },
                  { k: "Token", v: "USDC" },
                  { k: "USDC contract", v: <span className="num text-[11.5px]">{ARC.usdc}</span> },
                ]}
              />
              <Callout tone="info">Send on Arc only. USDC sent on another network can&apos;t be matched to your top-up. Arc&apos;s network fee is also paid in USDC (usually under a cent), so keep a little more than this amount in your wallet.</Callout>
              {scheduled.length > 0 && <Callout tone="warn" title="Autopilot may use this top-up immediately">{scheduled.map((p) => p.name).join(", ")} {scheduled.length === 1 ? "has" : "have"} scheduled scans enabled. A due scan can take 2 USDC of your credit as soon as this payment confirms. <Link href="/app/settings#autopilot" className="underline">Review Autopilot settings</Link> before paying if you want to start the scan yourself.</Callout>}
              {walletFunds && <PayWorkspaceWallet invoiceId={inv.id} amountMicro={inv.amountMicro} availableMicro={walletFunds.availableMicro} balanceMicro={walletFunds.balanceMicro} />}
              {walletUnavailable && <Callout tone="warn">{walletUnavailable}</Callout>}
              <PayInvoice invoiceId={inv.id} payTo={inv.payTo} amountMicro={inv.amountMicro} usdc={ARC.usdc} chainId={ARC.chainId} rpcUrl={ARC.publicRpcUrl} explorer={ARC.explorer} next={paymentNext} />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
