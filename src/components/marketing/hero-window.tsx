"use client";
import { useEffect, useState } from "react";
import { Check, FlaskConical, Inbox, LayoutGrid, Megaphone, Target } from "lucide-react";
import { LogoMark } from "@/components/layout/logo";
import { cn } from "@/components/ui/cn";

type Person = { who: string; where: string; said: string; fit: number; tag: string; hue: number };

const TABS: Record<"ready" | "warming" | "watching", { label: string; people: Person[] }> = {
  ready: {
    label: "Ready now",
    people: [
      { who: "maya.k", where: "Reddit · r/Coffee", said: "Any bean subscription that ships on Fridays? Mine keeps arriving stale.", fit: 92, tag: "asking for a pick", hue: 18 },
      { who: "dan_b", where: "Bluesky", said: "Switching roasters this month — who does a decaf that doesn't taste like cardboard?", fit: 88, tag: "switching", hue: 210 },
      { who: "ines.home", where: "YouTube comment", said: "Where did you get those beans? Link please, I need them for Sunday.", fit: 81, tag: "ready to buy", hue: 140 },
    ],
  },
  warming: {
    label: "Warming up",
    people: [
      { who: "tomasz", where: "Reddit · r/pourover", said: "Thinking about trying pour-over at home. Where do people even start?", fit: 64, tag: "researching", hue: 270 },
      { who: "lena_r", where: "Bluesky", said: "Is a burr grinder actually worth it for a beginner?", fit: 58, tag: "comparing", hue: 330 },
    ],
  },
  watching: {
    label: "Watching",
    people: [{ who: "kofi.a", where: "Hacker News", said: "Coffee prices are getting silly lately.", fit: 31, tag: "just chatting", hue: 45 }],
  },
};

const NAV = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Target, label: "Customers", active: true },
  { icon: Megaphone, label: "Creators" },
  { icon: FlaskConical, label: "Experiments" },
  { icon: Inbox, label: "Approvals", badge: 1 },
];

function Ticker({ to, ms = 1400 }: { to: number; ms?: number }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setN(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{n}</>;
}

/** The hero's product window: a live-feeling customer list you can tab through, and a payment you can approve (as a demo). */
export function HeroWindow() {
  const [tab, setTab] = useState<keyof typeof TABS>("ready");
  const [approved, setApproved] = useState<null | boolean>(null);
  return (
    <div className="relative mx-auto max-w-[1120px]">
      <div className="window text-left">
        <div className="flex h-12 items-center justify-between gap-3 border-b border-line px-5">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[12px]">
            <LogoMark size={16} className="text-accent" />
            <span className="text-ink">growtendril</span>
            <span className="text-ink-4">on</span>
            <span className="truncate text-ink">yourshop.com</span>
          </div>
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-ink-3 ring-1 ring-line">Illustrative example</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-mint/45 px-5 py-2.5 font-mono text-[12px] text-accent">
          <span className="flex items-center gap-1.5">
            <LogoMark size={13} className="text-accent" />
            <Ticker to={3} /> possible buyers in <Ticker to={23} /> example posts
          </span>
          <span className="text-ink-3">Sample scan · fictional profiles</span>
          <span className="text-ink-3">No real payment</span>
        </div>
        <div className="grid md:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="hidden border-r border-line bg-surface-2/60 p-4 md:block">
            <div className="label mb-3 px-2">yourshop.com</div>
            <ul className="space-y-0.5 text-[13px]">
              {NAV.map((n) => (
                <li key={n.label} className={cn("flex h-9 items-center gap-2.5 rounded-[11px] px-2.5", n.active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.07),0_2px_6px_-3px_rgb(10_11_12/0.15)]" : "text-ink-3")}>
                  <n.icon className={cn("size-4", n.active ? "text-accent" : "text-ink-4")} strokeWidth={1.75} />
                  <span className="flex-1">{n.label}</span>
                  {n.active && <span className="grid size-5 place-items-center rounded-full bg-mint"><LogoMark size={11} className="text-accent" /></span>}
                  {n.badge && <span className="num rounded-full bg-warning/15 px-1.5 text-[10.5px] text-warning">{n.badge}</span>}
                </li>
              ))}
            </ul>
          </aside>
          <div className="min-w-0 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[15px] font-semibold">Customers</h3>
              <div className="inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-line" role="tablist" aria-label="Customer readiness">
                {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn("flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-[background-color,color] duration-200", tab === k ? "bg-ink text-white" : "text-ink-3 hover:text-ink")}
                  >
                    {TABS[k].label}
                    {tab === k && <span className="grid size-4 place-items-center rounded-full bg-white"><LogoMark size={9} className="text-accent" /></span>}
                  </button>
                ))}
              </div>
            </div>
            <ul key={tab} className="mt-4 space-y-2">
              {TABS[tab].people.map((p, i) => (
                <li
                  key={p.who}
                  className={cn("group grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3 rounded-[16px] px-3 py-3 transition-colors sm:grid-cols-[32px_minmax(0,1fr)_auto]", i === 0 && tab === "ready" ? "bg-surface-2/80" : "hover:bg-surface-2/60")}
                  style={{ animation: "rise-in 420ms cubic-bezier(0.2,0.75,0.2,1) both", animationDelay: `${i * 80}ms` }}
                >
                  <span className="grid size-8 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ background: `oklch(0.62 0.12 ${p.hue})` }}>
                    {p.who[0].toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                      <span className="font-semibold text-ink">{p.who}</span>
                      <span className="text-ink-4">{p.where}</span>
                    </div>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">“{p.said}”</p>
                  </div>
                  <div className="col-start-2 flex items-center gap-3 sm:col-start-3 sm:flex-col sm:items-end sm:gap-1.5">
                    <span className="flex items-baseline gap-1">
                      <span className={cn("display text-[20px] leading-none", p.fit >= 80 ? "text-accent" : p.fit >= 50 ? "text-ink-2" : "text-ink-4")}>{p.fit}</span>
                      <span className="font-mono text-[10px] text-ink-4">fit</span>
                    </span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink-3 ring-1 ring-line">{p.tag}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className={cn("relative mt-4 flex flex-col gap-3 rounded-[18px] p-4 ring-1 transition-colors duration-500 sm:flex-row sm:items-center sm:justify-between", approved ? "bg-mint/60 ring-good/25" : approved === false ? "bg-surface-2 ring-line" : "glow-peach ring-serious/20")}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-4">
                  <span className={cn("size-1.5 rounded-full", approved ? "bg-good" : "pulse bg-serious")} />
                  {approved ? "Example approval · no payment sent" : approved === false ? "Example skipped · nothing paid" : "Example · needs your yes"}
                </div>
                <p className="mt-1 text-[14px] text-ink">
                  Pay <span className="font-semibold">@thebrewguide</span> <span className="num font-medium">5 USDC</span> toward a review campaign?
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">Fictional creator and campaign. You choose the payment ceiling; new workspaces start at 10 USDC.</p>
              </div>
              {approved == null ? (
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setApproved(true)} className="btn-sheen inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-transform hover:-translate-y-px active:scale-95">
                    <Check className="size-3.5" /> Approve
                  </button>
                  <button onClick={() => setApproved(false)} className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[13px] font-medium text-ink-2 shadow-[0_0_0_1px_rgb(10_11_12/0.1)] transition-transform hover:-translate-y-px active:scale-95">
                    Not now
                  </button>
                </div>
              ) : (
                <button onClick={() => setApproved(null)} className="shrink-0 text-[12px] text-ink-3 underline decoration-line-strong underline-offset-3 hover:text-ink">
                  Demo only — reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute -bottom-14 right-[150px] hidden items-start gap-1 md:flex">
        <p className="hand mt-5 -rotate-3 text-[17px] text-ink/55">nothing moves until you tap this</p>
        <svg viewBox="0 0 60 50" className="h-11 w-12 text-ink/45" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 44 C 26 40, 40 28, 44 6" />
          <path d="M35 13 L 44 5 L 50 15" />
        </svg>
      </div>
    </div>
  );
}
