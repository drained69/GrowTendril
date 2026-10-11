import Link from "next/link";
import { ArrowRight, Building2, FileCheck2, FlaskConical, Megaphone, PlayCircle, Radar, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { getDb } from "@/server/db/client";
import { currentUser } from "@/server/auth/current";
import { tractionMetrics } from "@/server/queries/metrics";
import { enterDemoAction } from "@/server/actions/auth";
import { fmtUsdc } from "@/lib/money";
import { Badge, ModeBadge, buttonClass } from "@/components/ui";
import { Logo } from "@/components/layout/logo";
import { isMainnetEnv } from "@/server/integrations/circle/network-env";

export const dynamic = "force-dynamic";

const QUESTIONS = [
  { icon: <Building2 />, tag: "Customer discovery", q: "Who wants your product?", a: "Finds companies showing real buying intent — launches, hiring, migrations, public questions — and shows every source behind every score." },
  { icon: <TrendingUp />, tag: "Narrative intelligence", q: "What is your market talking about?", a: "Maps narratives across public conversations: which are emerging, accelerating, peaking or fading — and how relevant each is to you." },
  { icon: <Megaphone />, tag: "Creator intelligence", q: "Who shapes the market?", a: "Ranks creators by audience fit, authority, recency, discussion quality and authenticity — not follower count — with evidence-backed briefs." },
  { icon: <FlaskConical />, tag: "Experiments & reallocation", q: "Where should the next dollar go?", a: "Runs experiments with hypotheses and stop conditions, measures real conversions, and moves unspent budget to what works." },
];

const LOOP = ["Discover", "Understand", "Verify", "Decide", "Spend", "Execute", "Measure", "Attribute", "Learn", "Reallocate"];

const RECEIPT = [
  ["Action", "Buy data (x402)"],
  ["Service", "company-intel · 0.01 USDC"],
  ["Why", "intent confidence 60% < 80% threshold"],
  ["Value of info", "≈ 5.00 USDC (500× price)"],
  ["Policy", "ALLOW · research ≤ 10 USDC"],
  ["Payment", "Circle Gateway · Arc"],
  ["Result", "+3 verified signals"],
  ["Confidence", "60% → 90%"],
];

const RAILS = [
  { icon: <ShieldCheck />, title: "Policy engine", body: "Max transaction, daily spend, mission budget, categories, creator and bounty thresholds, tokens and chains — checked in code." },
  { icon: <Wallet />, title: "Approval Inbox", body: "Anything above your limits waits for a human. Above the hard ceiling it is denied, approval or not." },
  { icon: <FileCheck2 />, title: "Decision receipts", body: "Every action records what the agent saw, why it acted, the policy verdict, the payment and the outcome — sha256-sealed." },
];

function DemoCta({ className }: { className?: string }) {
  return (
    <form action={enterDemoAction}>
      <button type="submit" className={buttonClass("secondary", "lg", className)}>
        <PlayCircle />
        See it work
      </button>
    </form>
  );
}

export default async function Landing() {
  const [m, user] = await Promise.all([getDb().then((db) => tractionMetrics(db)), currentUser()]);
  const signedIn = !!user && !user.isGuest;
  const mainnet = isMainnetEnv();
  const traction: { k: string; v: string | number }[] = [
    { k: "Live workspaces", v: m.projects },
    { k: "Opportunities found", v: m.opportunities },
    { k: "Qualified customers", v: m.qualified },
    { k: "Creators identified", v: m.kols },
    { k: "Experiments", v: m.experiments },
    { k: "Agent decisions", v: m.decisions },
    { k: "Autonomous actions", v: m.autonomous },
    { k: "Human approvals", v: m.approvals },
    { k: "x402 purchases", v: m.x402 },
    { k: "Arc transactions", v: m.arcTx },
    { k: "USDC spent", v: fmtUsdc(m.spentMicro, { unit: false }) },
    { k: "Attributed conversions", v: m.conversions },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 text-[13px] text-ink-2">
            <a href="#how" className="hidden rounded-[6px] px-2.5 py-1.5 hover:text-ink sm:block">
              How it works
            </a>
            <a href="#money" className="hidden rounded-[6px] px-2.5 py-1.5 hover:text-ink sm:block">
              Money &amp; rules
            </a>
            <a href="#traction" className="hidden rounded-[6px] px-2.5 py-1.5 hover:text-ink md:block">
              Traction
            </a>
            {signedIn ? (
              <Link href="/app" className={buttonClass("primary", "sm", "ml-2")}>
                Open app <ArrowRight />
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-[6px] px-2.5 py-1.5 hover:text-ink">
                  Sign in
                </Link>
                <Link href="/signup" className={buttonClass("primary", "sm", "ml-1")}>
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="grid-bg relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_25%_0%,rgb(57_135_229/0.16),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.15fr_1fr] lg:py-28">
          <div>
            <Badge tone="info" className="h-6 px-2 text-[11.5px]">
              Built on Circle &amp; Arc · USDC
            </Badge>
            <h1 className="mt-5 text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[60px]">
              Your autonomous
              <br />
              growth operator.
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-2">
              Give it a product, a goal and a USDC budget. GrowTendril finds where growth is hiding, spends within the rules you set, and measures what actually converts.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={signedIn ? "/app" : "/signup"} className={buttonClass("primary", "lg")}>
                {signedIn ? "Open your workspace" : "Start a mission"}
                <ArrowRight />
              </Link>
              <DemoCta />
            </div>
            <p className="mt-4 text-[12px] text-ink-3">The demo is a private, seeded workspace — no keys needed. Demo data is fictional and always labelled.</p>
          </div>

          <div className="self-center rounded-[12px] border border-line-strong bg-surface/95 shadow-[var(--shadow-pop)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <FileCheck2 className="size-4 text-ink-3" />
                Decision receipt
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-4">
                illustrative example <ModeBadge mode="DEMO" />
              </span>
            </div>
            <dl className="divide-y divide-line px-4 py-1">
              {RECEIPT.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-3 py-2 text-[12px]">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="num text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-20">
        <div className="max-w-2xl">
          <div className="label text-s1">How it works</div>
          <h2 className="mt-2 text-[30px] font-semibold tracking-[-0.025em] text-ink">Four questions every founder asks — answered with evidence.</h2>
        </div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line md:grid-cols-2">
          {QUESTIONS.map((x) => (
            <div key={x.q} className="bg-surface p-7">
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
                <span className="grid size-6 place-items-center rounded-[6px] bg-surface-2 text-s1 ring-1 ring-line-strong [&_svg]:size-3.5">{x.icon}</span>
                {x.tag}
              </div>
              <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-ink">{x.q}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{x.a}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-[12px] border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
            <Radar className="size-3.5" />
            The operator loop
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12.5px]">
            {LOOP.map((l, i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="rounded-[6px] border border-line-strong bg-surface-2 px-2.5 py-1 font-medium text-ink">{l}</span>
                {i < LOOP.length - 1 && <ArrowRight className="size-3 text-ink-4" />}
              </span>
            ))}
            <span className="ml-1 text-ink-4">↺ repeat</span>
          </div>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-ink-3">
            Optimizes verified growth per USDC spent — not followers, impressions, posts or emails sent. It never sends mass unsolicited messages; it finds qualified opportunities and shows a human the evidence.
          </p>
        </div>
      </section>

      <section id="money" className="scroll-mt-16 border-y border-line bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="label text-s1">A company card with strict limits</div>
            <h2 className="mt-2 text-[30px] font-semibold tracking-[-0.025em] text-ink">Financial autonomy lives in code, not in a prompt.</h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">
              Every money movement is a structured action, validated by a schema and checked by a deterministic policy engine before anything executes.
            </p>
            <ul className="mt-8 space-y-5">
              {RAILS.map((r) => (
                <li key={r.title} className="flex gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[7px] bg-surface-2 text-s1 ring-1 ring-line-strong [&_svg]:size-3.5">{r.icon}</span>
                  <span>
                    <span className="block text-[13.5px] font-medium text-ink">{r.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">{r.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="self-center overflow-hidden rounded-[12px] border border-line-strong bg-bg">
            <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
              <span className="size-2 rounded-full bg-line-strong" />
              <span className="size-2 rounded-full bg-line-strong" />
              <span className="size-2 rounded-full bg-line-strong" />
              <span className="ml-2 text-[11.5px] text-ink-4">execution path</span>
            </div>
            <pre className="num overflow-x-auto p-5 text-[12.5px] leading-[1.9] text-ink-2">{`AI ─► structured action ─► schema validation
   ─► policy engine ─► ALLOW | APPROVAL | DENY
   ─► transaction state machine (idempotent)
   ─► Circle  (x402 · Gateway · Wallets)
   ─► Arc     (USDC settlement)
   ─► decision receipt (sha256-sealed)`}</pre>
          </div>
        </div>
      </section>

      <section id="traction" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label text-s1">Traction</div>
            <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.025em] text-ink">Live counts from this deployment</h2>
          </div>
          <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-3">
            Measured from the database on every page load. Demo workspaces are excluded; a live workspace has finished setup and run at least one cycle. Money counts only transactions submitted to Circle on Arc{mainnet ? "" : " Testnet (test USDC)"} — never simulated ones — and USDC spent excludes treasury moves.
          </p>
        </div>
        {m.projects > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            {traction.map((x) => (
              <div key={x.k} className="bg-surface px-4 py-4">
                <div className="num text-[22px] font-medium tracking-[-0.03em] text-ink">{x.v}</div>
                <div className="mt-1 text-[11.5px] text-ink-3">{x.k}</div>
              </div>
            ))}
            <div className="col-span-2 bg-surface px-4 py-4 sm:col-span-3 lg:col-span-6">
              <span className="text-[11.5px] text-ink-3">
                Cost per attributed conversion: <span className="num text-ink-2">{m.costPerConversion ? `${fmtUsdc(m.costPerConversion)}` : "not yet measurable"}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-8 rounded-[12px] border border-dashed border-line-strong px-6 py-10 text-center">
            <div className="text-[13.5px] font-medium text-ink">No live workspaces yet</div>
            <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-3">Counts appear here as soon as a real workspace runs its first cycle. We don&apos;t show placeholder numbers.</p>
          </div>
        )}
      </section>

      <section className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-14">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Give your AI a growth goal and a budget.</h2>
            <p className="mt-1 text-[13.5px] text-ink-3">Set up a workspace in a few minutes, or explore a seeded one first.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={signedIn ? "/app" : "/signup"} className={buttonClass("primary", "lg")}>
              {signedIn ? "Open app" : "Create workspace"}
              <ArrowRight />
            </Link>
            <DemoCta />
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
          <div className="flex items-center gap-4">
            <Logo />
            <div className="flex flex-wrap gap-1.5">
              {["Arc", "USDC", "Circle Agent Stack", "x402", "Gateway"].map((p) => (
                <Badge key={p} tone="muted">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-[12px] text-ink-3">{mainnet ? "Running on Arc mainnet." : "Running on Arc Testnet — payments use test USDC."} Demo data is fictional and always labelled.</div>
        </div>
      </footer>
    </div>
  );
}
