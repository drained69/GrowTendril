import Link from "next/link";
import { getDb } from "@/server/db/client";
import { currentUser } from "@/server/auth/current";
import { tractionMetrics } from "@/server/queries/metrics";
import { fmtUsdc } from "@/lib/money";
import { Logo } from "@/components/layout/logo";
import { Clouds } from "@/components/ui/sky";
import { HeroWindow } from "@/components/marketing/hero-window";
import { WebsiteStart } from "@/components/marketing/website-start";
import { Chores, Faq, Finale, Footer, Guardrails, Intro, LiveCounts, Pricing, Receipts, Shortlist, Terms, Trio } from "@/components/marketing/sections";

export const dynamic = "force-dynamic";

const NAV = [
  ["What it does", "#product"],
  ["How it works", "#how"],
  ["Your rules", "#controls"],
  ["Pricing", "#pricing"],
];

export default async function Landing() {
  const [metrics, user] = await Promise.all([getDb().then((db) => tractionMetrics(db)), currentUser()]);
  const signedIn = !!user && !user.isGuest;
  const startHref = signedIn ? "/app" : "/signup";
  const startLabel = signedIn ? "Open workspace" : "Start a mission";
  return (
    <div className="marketing min-h-screen bg-surface text-ink">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <section className="sky rounded-[40px]">
          <Clouds set="hero" />
          <header className="relative z-20 mx-auto flex h-20 max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
            <Link href="/" aria-label="GrowTendril home" className="shrink-0"><Logo grow /></Link>
            <nav aria-label="Main" className="hidden items-center gap-8 text-[14px] text-ink/70 md:flex">
              {NAV.map(([label, href]) => <a key={href} href={href} className="transition-colors hover:text-ink">{label}</a>)}
            </nav>
            <div className="flex items-center gap-4">
              {!signedIn && <Link href="/login" className="hidden text-[14px] text-ink/70 transition-colors hover:text-ink sm:inline">Sign in</Link>}
              <Link href={startHref} className="btn-sheen inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-transform hover:-translate-y-px">{startLabel}</Link>
            </div>
          </header>

          <div className="relative z-10 mx-auto max-w-[1240px] px-5 pt-14 text-center sm:px-8 sm:pt-20">
            <div className="text-[14px] text-ink/55" style={{ animation: "rise-in 600ms cubic-bezier(0.2,0.75,0.2,1) both" }}>For shops, apps, services and software</div>
            <h1 className="display display-bounce mx-auto mt-5 text-[clamp(2.2rem,4.3vw,3.6rem)] leading-[1.1] text-ink" style={{ animation: "rise-in 700ms 80ms cubic-bezier(0.2,0.75,0.2,1) both" }}>
              Find your next customers.
              <br />
              Know <span className="scribble">what to try</span> next.
            </h1>
            <p className="mx-auto mt-6 max-w-[600px] text-[clamp(1.05rem,1.6vw,1.25rem)] leading-[1.55] text-ink/65" style={{ animation: "rise-in 700ms 160ms cubic-bezier(0.2,0.75,0.2,1) both" }}>
              Start with your website. GrowTendril finds relevant conversations and creators, recommends small growth tests, and connects recorded results to what you spent.
            </p>
            <WebsiteStart signedIn={signedIn} />
            <div className="mt-16 pb-14 sm:mt-20 sm:pb-20" style={{ animation: "rise-in 900ms 360ms cubic-bezier(0.2,0.75,0.2,1) both" }}>
              <HeroWindow />
            </div>
          </div>
        </section>
      </div>

      <main>
        <Intro />
        <Chores />
        <Trio />
        <Guardrails />
        <Shortlist />
        <Receipts />
        {metrics.projects >= 3 && (
          <LiveCounts
            items={(
              [
                ["Workspaces growing", metrics.projects],
                ["Qualified customers found", metrics.qualified],
                ["Operator decisions", metrics.decisions],
                ["USDC spent, with approval", metrics.spentMicro > 0 ? fmtUsdc(metrics.spentMicro, { unit: false }) : 0],
              ] as [string, string | number][]
            ).filter(([, v]) => v !== 0)}
          />
        )}
        <Pricing startHref={startHref} signedIn={signedIn} />
        <Terms />
        <Faq />
        <Finale startHref={startHref} signedIn={signedIn} />
      </main>
      <Footer startHref={startHref} signedIn={signedIn} />
    </div>
  );
}
