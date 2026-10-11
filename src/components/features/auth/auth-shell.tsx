import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, LogoMark } from "@/components/layout/logo";
import { Clouds } from "@/components/ui/sky";

const POINTS = [
  ["Find the signal", "Real people asking for what you sell — every one linked to its source."],
  ["Set the boundary", "A goal and a budget. Nothing is paid until you approve it."],
  ["Learn from the result", "Every action keeps a receipt and a measured outcome."],
];

/** Shared frame for sign-in, sign-up and invite pages: open sky on the left, the form on the right. */
export function AuthShell({ children, title, description, footer }: { children: ReactNode; title: string; description?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside className="sky relative m-3 hidden min-h-[calc(100vh-24px)] flex-col justify-between rounded-[32px] p-10 lg:flex xl:p-14">
        <Clouds set="hero" />
        <LogoMark size={480} sway className="pointer-events-none absolute -bottom-24 -right-20 text-accent opacity-[0.08]" />
        <Link href="/" className="relative w-fit" aria-label="GrowTendril home"><Logo grow size={30} /></Link>
        <div className="relative max-w-[540px] pb-6">
          <div className="text-[13px] font-medium text-ink/55">Growth, with a reason behind every move</div>
          <h2 className="display display-bounce mt-5 text-[clamp(2.3rem,3.4vw,3.7rem)] leading-[1.06] text-ink">
            Your market leaves clues.
            <br />
            Let&apos;s <span className="scribble">follow them.</span>
          </h2>
          <p className="mt-6 max-w-[440px] text-[17px] leading-[1.6] text-ink/65">GrowTendril turns public signals into bounded action, then uses measured results to choose the next move.</p>
          <div className="mt-10 grid gap-2.5">
            {POINTS.map(([label, detail], i) => (
              <div
                key={label}
                className="flex items-start gap-3.5 rounded-[18px] bg-white/70 p-4 shadow-[0_0_0_1px_rgb(10_11_12/0.05),0_10px_30px_-20px_rgb(10_11_12/0.4)] backdrop-blur-md transition-transform duration-300 hover:-translate-y-0.5"
                style={{ animation: "rise-in 600ms cubic-bezier(0.2,0.75,0.2,1) both", animationDelay: `${300 + i * 140}ms` }}
              >
                <span className="display grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[14px] text-white">{i + 1}</span>
                <div>
                  <div className="text-[14.5px] font-semibold text-ink">{label}</div>
                  <div className="mt-0.5 text-[13px] leading-relaxed text-ink/60">{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative flex items-center gap-2 text-[12px] text-ink/55">
          <span className="live-halo size-1.5 rounded-full bg-good text-good" />
          USDC on Arc · every payment approved by you
        </p>
      </aside>

      <main className="flex min-h-screen flex-col px-5 py-7 sm:px-10 lg:px-14">
        <Link href="/" className="w-fit lg:hidden" aria-label="GrowTendril home"><Logo grow /></Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-14" style={{ animation: "rise-in 520ms cubic-bezier(0.2,0.75,0.2,1) both" }}>
          <div className="eyebrow">Your workspace</div>
          <h1 className="display display-bounce mt-3 text-[34px] leading-tight text-ink">{title}</h1>
          {description && <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-3">{description}</p>}
          <div className="mt-9">{children}</div>
          {footer && <div className="mt-7 text-center text-[13px] text-ink-3">{footer}</div>}
        </div>
        <div className="hand text-[13px] text-ink-4">evidence → decision → action → learning</div>
      </main>
    </div>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[12px] text-ink-4">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
