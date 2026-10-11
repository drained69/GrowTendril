import { ArrowRight, FlaskConical, ListChecks, Tag, Wallet } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { DEMO_STEPS } from "@/server/demo/script";
import { ARC, platformCustody } from "@/server/integrations/circle/config";
import { getWallet, walletIsLive } from "@/server/integrations/circle/wallets";
import { SIGNALS_API_URL } from "@/server/integrations/circle/marketplace";
import { claudeEnabled } from "@/server/integrations/llm/claude";
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton, ModeBadge, PageHeader, StatusDot } from "@/components/ui";
import { DemoRunner } from "@/components/features/demo/demo-runner";

async function sellerStatus(): Promise<{ ok: boolean; note: string }> {
  try {
    const r = await fetch(SIGNALS_API_URL, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    const j = (await r.json()) as { paywall?: string; seller?: string | null };
    return { ok: !!j.seller, note: j.paywall ?? "unknown" };
  } catch {
    return { ok: false, note: `not reachable at ${SIGNALS_API_URL}` };
  }
}

const Code = ({ children }: { children: React.ReactNode }) => <code className="num rounded-[4px] bg-surface-3 px-1 py-px text-[11.5px] text-ink">{children}</code>;

export default async function Demo() {
  const { project, role, db } = await requireProject();
  if (project.dataMode !== "DEMO")
    return (
      <div className="space-y-4">
        <PageHeader title="Guided demo" description="An eight-step walkthrough of the full operator loop on fictional data." />
        <EmptyState
          icon={<FlaskConical />}
          title="The guided demo runs on the DEMO workspace"
          description="Switch to “Meterline (DEMO)” in the workspace menu, or enter the demo from the login page. Your real workspace is never touched by the demo."
          action={<LinkButton href="/app">Back to overview</LinkButton>}
        />
      </div>
    );

  const custody = platformCustody();
  const [wallet, seller] = await Promise.all([getWallet(db, project.id), sellerStatus()]);
  const live = walletIsLive(wallet);
  const claude = claudeEnabled();

  const real = [
    { tone: "good" as const, label: "Engine", value: "Real code paths" },
    { tone: live ? ("good" as const) : ("warn" as const), label: "Wallet", value: live ? `Workspace wallet · ${ARC.name}` : custody ? `${custody === "circle" ? "Circle" : "Development key"} available · demo stays simulated` : "None → SIMULATED" },
    { tone: seller.ok ? ("good" as const) : ("warn" as const), label: "x402 seller", value: seller.note },
    { tone: claude ? ("good" as const) : ("idle" as const), label: "Claude", value: claude ? "Drafts & extraction" : "Off → templates" },
    { tone: "info" as const, label: "Market data", value: "DEMO corpus" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Guided demo — First 100 Developers"
        description="Meterline is a fictional AI-agent developer tool with 500 test USDC. Each step calls the same engine the autonomous operator uses. The founder sets goal, budget and rules — not steps."
        meta={
          <>
            <ModeBadge mode="DEMO" />
            <span>{DEMO_STEPS.length} steps</span>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <DemoRunner steps={DEMO_STEPS} canRun={can(role, "operate")} canReset={can(role, "manage_workspace")} />
        <div className="space-y-4">
          <Card>
            <CardHeader title="What is real here" icon={<ListChecks />} />
            <ul className="divide-y divide-line">
              {real.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px]">
                  <span className="flex items-center gap-2 text-ink-2">
                    <StatusDot tone={r.tone} /> {r.label}
                  </span>
                  <span className="min-w-0 truncate text-right text-[12px] text-ink" title={r.value}>
                    {r.value}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Labels" icon={<Tag />} />
            <ul className="space-y-2.5 px-4 py-3 text-[12px] leading-snug text-ink-2">
              <li className="flex items-start gap-2">
                <ModeBadge mode="DEMO" className="mt-px" /> Fictional seeded data — posts, companies, creators, conversions.
              </li>
              <li className="flex items-start gap-2">
                <ModeBadge mode="SIMULATED" className="mt-px" /> A payment that would have happened; no funds moved, no IDs or hashes.
              </li>
              <li className="flex items-start gap-2">
                <ModeBadge mode="TESTNET" className="mt-px" /> Real Circle Gateway / Arc Testnet activity with verifiable IDs and hashes.
              </li>
              <li className="flex items-start gap-2">
                <ModeBadge mode="LIVE" className="mt-px" /> Real public data from providers, and real funds on Arc mainnet.
              </li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Make the payments real" icon={<Wallet />} action={<Badge tone={ARC.network === "mainnet" ? "good" : "info"}>{ARC.name}</Badge>} />
            <CardBody>
              <ol className="list-decimal space-y-1.5 pl-4 text-[12px] leading-snug text-ink-2 marker:text-ink-4">
                <li>
                  Set <Code>CIRCLE_API_KEY</Code> and <Code>CIRCLE_ENTITY_SECRET</Code> on the server (or, on testnet, a development key).
                </li>
                <li>Create a real workspace and its wallet from the Wallet page.</li>
                <li>{ARC.faucet ? "Fund it at faucet.circle.com (Arc Testnet)" : `Fund it with USDC on ${ARC.name}`}, then deposit into Gateway from the Wallet page.</li>
                <li>
                  Set <Code>SIGNALS_SELLER_ADDRESS</Code> so the bundled x402 seller accepts payments.
                </li>
              </ol>
              <LinkButton href="/app/wallet" size="xs" variant="ghost" className="mt-3 -ml-2" icon={<ArrowRight />}>
                Wallet
              </LinkButton>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
