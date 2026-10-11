import Link from "next/link";
import type { ReactNode } from "react";
import { FileCheck2, Radar, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { isMainnetEnv } from "@/server/integrations/circle/network-env";

const POINTS = [
  { icon: <Radar />, title: "Evidence before opinion", body: "Every customer, narrative and creator score links back to the public sources behind it." },
  { icon: <ShieldCheck />, title: "Hard limits in code", body: "A deterministic policy engine checks every USDC payment. Above your limits, a human decides." },
  { icon: <FileCheck2 />, title: "A receipt for every decision", body: "What the agent saw, why it acted, what it cost, and what it produced — sealed and auditable." },
];

/** Split-screen frame for sign-in, sign-up and invite pages. */
export function AuthShell({ children, title, description, footer }: { children: ReactNode; title: string; description?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="grid-bg relative hidden flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,rgb(57_135_229/0.14),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        <Link href="/" className="relative">
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">Give your AI a growth goal and a budget.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">GrowthOS finds where growth is hiding, spends USDC within your rules, and measures what actually converts.</p>
          <ul className="mt-8 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[7px] bg-surface-2 text-s1 ring-1 ring-line-strong [&_svg]:size-3.5">{p.icon}</span>
                <span>
                  <span className="block text-[13px] font-medium text-ink">{p.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-3">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[11.5px] text-ink-4">{isMainnetEnv() ? "Arc mainnet" : "Arc Testnet"} · Circle &amp; Arc · Demo data is fictional and always labelled.</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {description && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{description}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-[12.5px] text-ink-3">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-4">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
