import type { ReactNode } from "react";
import { LogoMark } from "@/components/layout/logo";
import { Clouds } from "@/components/ui/sky";
import { Greeting, Today } from "@/components/features/workspace/greeting";

/** The first thing on the dashboard: a patch of sky with who it is for, what state the operator is in, and the next move. */
export function OverviewHero({ name, workspace, chips, actions, nextMove }: { name: string; workspace: string; chips: ReactNode; actions: ReactNode; nextMove?: { title: string; detail: string } }) {
  return (
    <div className="sky-soft group relative rounded-[28px] px-6 py-7 shadow-[var(--shadow-card)] ring-1 ring-black/[0.04] sm:px-9 sm:py-9">
      <Clouds set="few" />
      <LogoMark size={190} sway className="pointer-events-none absolute -bottom-10 right-6 hidden text-accent opacity-[0.12] sm:block" />
      <div className="relative">
        <div className="text-[13px] font-medium text-ink/55">
          <Greeting name={name} /> <span aria-hidden="true">·</span> <Today />
        </div>
        {nextMove && <div className="label mt-5 text-accent">Your next move</div>}
        <h1 className="display display-bounce mt-2 text-[clamp(1.8rem,2.8vw,2.35rem)] leading-[1.12] text-ink">
          {nextMove?.title ?? <Greeting name={name} />}
        </h1>
        <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-ink/65">
          {nextMove?.detail ?? <>Here is where <span className="font-semibold text-ink">{workspace}</span> stands — the goal, the money, the evidence, and what your operator decided.</>}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px] text-ink/60">{chips}</div>
        <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
