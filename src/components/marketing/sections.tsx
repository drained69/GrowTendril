import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Coins, Minus, Plus, ShieldCheck, Snowflake, X } from "lucide-react";
import { Logo, LogoMark } from "@/components/layout/logo";
import { Reveal } from "@/components/ui/reveal";
import { Eyebrow, Headline, Lede, Section } from "@/components/marketing/primitives";
import { RotatingWord } from "@/components/marketing/rotating-word";
import { MIN_TOPUP_USDC, SERVICE_KEYS, SERVICES } from "@/lib/services";
import { cn } from "@/components/ui/cn";

const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

/* ───────────── Introducing ───────────── */

export function Intro() {
  return (
    <section id="product" className="scroll-mt-20 py-24 sm:py-32">
      <Reveal className="mx-auto grid max-w-[1100px] gap-6 px-5 sm:px-8 md:grid-cols-[230px_minmax(0,1fr)]">
        <Eyebrow className="self-start pt-1.5">Introducing GrowTendril</Eyebrow>
        <div className="space-y-7 text-[clamp(1.05rem,1.6vw,1.3rem)] leading-[1.6] text-ink/85">
          <p>
            Somewhere right now, someone is asking a forum for exactly what you sell. Someone else is complaining about the competitor you beat. A creator your customers trust just posted about your category. You will never see any of it — there is too much, and it moves too fast.
          </p>
          <p>
            GrowTendril reads it for you. It keeps the clues that matter, links each one to where it was said, and turns the best into a small experiment with a budget and a stop condition. <span className="font-semibold text-ink">You approve the spend.</span> It measures what happened, and the next move starts from there.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────────── The boring work ───────────── */

const CHORES = [
  "read r/smallbusiness", "find people asking for a recommendation", "spot a competitor complaint", "notice a trend speeding up",
  "shortlist creators who post about your category", "flag suspicious creator engagement", "draft a first message", "write a campaign brief",
  "make a tracked link", "count who clicked", "compare two experiments", "pause what isn't working",
  "write the morning brief", "pay a creator — after you approve", "keep the receipt", "score a lead's fit",
  "find a creator's public email", "watch a launch thread", "refresh the influencer report", "flag a stale campaign",
];

export function Chores() {
  return (
    <Section className="bg-[#f5f5f4]">
      <div className="mx-auto max-w-[1100px] px-5 text-center sm:px-8">
        <Reveal>
          <Eyebrow>The boring work</Eyebrow>
          <Headline center>
            All the growth chores,
            <br />
            done before your coffee cools.
          </Headline>
        </Reveal>
        <Reveal delay={100} className="fade-down mx-auto mt-12 flex max-w-[960px] flex-wrap justify-center gap-2.5">
          {CHORES.map((c, i) => (
            <span
              key={c}
              style={stagger(i % 8)}
              className={cn(
                "stagger cursor-default rounded-full bg-white px-4 py-2.5 text-[14px] text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.06),0_2px_6px_-3px_rgb(10_11_12/0.12)] transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.3,1.6,0.5,1)] hover:-translate-y-1 hover:bg-mint",
                i % 3 === 0 ? "hover:-rotate-2" : i % 3 === 1 ? "hover:rotate-2" : "hover:rotate-1",
              )}
            >
              {c}
            </span>
          ))}
        </Reveal>
        <Reveal delay={200}>
          <p className="mx-auto mt-10 max-w-[460px] text-[16px] leading-relaxed text-ink/60">None of it is clever. All of it is repeated. That is exactly the work worth handing to an operator.</p>
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── Finds · Checks · Asks ───────────── */

function MockCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[14px] bg-white p-4 shadow-[0_0_0_1px_rgb(10_11_12/0.06),0_18px_40px_-24px_rgb(10_11_12/0.35)]", className)}>{children}</div>;
}

export function Trio() {
  const steps = ["read r/Coffee", "read Bluesky", "read YouTube comments", "keep the 4 asking to buy", "link each to its post"];
  return (
    <Section id="how" className="border-t-0">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <Eyebrow>How a cycle works</Eyebrow>
          <Headline>
            Finds it. Checks it.
            <br />
            Asks before it spends.
          </Headline>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Reveal className="group">
            <div className="glow-butter relative h-[270px] overflow-hidden rounded-[24px] p-6 pr-0 ring-1 ring-black/[0.04]">
              <MockCard className="-mr-6 mt-4 rounded-r-none">
                <div className="font-mono text-[11px] text-ink-4">example scan · yourshop.com</div>
                <ul className="mt-3 space-y-2.5">
                  {steps.map((s, i) => (
                    <li key={s} className="stagger flex items-center gap-2.5 text-[13.5px]" style={stagger(i)}>
                      <span className="grid size-5 place-items-center rounded-full bg-mint text-accent ring-1 ring-good/25"><Check className="size-3" strokeWidth={3} /></span>
                      <span className="font-mono text-[11px] text-ink-4">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </MockCard>
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60"><span className="font-semibold text-ink">Finds the clue.</span> It reads the places your customers talk and keeps only posts that show intent — each linked to where it was said.</p>
          </Reveal>

          <Reveal delay={100} className="group">
            <div className="glow-mint relative grid h-[270px] place-items-center overflow-hidden rounded-[24px] p-6 ring-1 ring-black/[0.04]">
              <MockCard className="w-full max-w-[290px] transition-transform duration-500 group-hover:-rotate-1">
                <div className="font-mono text-[11px] text-ink-4">example score · maya.k · Reddit</div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="display text-[52px] leading-none text-ink">92</span>
                  <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-medium text-accent">✓ strong fit</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {[["intent", 88], ["fit", 92], ["recency", 97]].map(([k, v], i) => (
                    <div key={k} className="flex items-center gap-2 text-[11px] text-ink-3">
                      <span className="w-14 font-mono">{k}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="bar-grow block h-full rounded-full bg-accent" style={{ width: `${v}%`, animationDelay: `${300 + i * 120}ms` }} /></span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["asked for a pick", "posted today", "3 sources"].map((t) => <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-3">{t}</span>)}
                </div>
              </MockCard>
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60"><span className="font-semibold text-ink">Checks the evidence.</span> Customers and creators are scored on what they actually said, not follower counts. Open the source behind any number.</p>
          </Reveal>

          <Reveal delay={200} className="group">
            <div className="glow-peach relative h-[270px] overflow-hidden rounded-[24px] p-6 pl-0 ring-1 ring-black/[0.04]">
              <MockCard className="-ml-6 mt-6 rounded-l-none pl-8">
                <div className="font-mono text-[11px] text-ink-4">example payment · policy v3</div>
                <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-critical/[0.07] px-2.5 py-2 font-mono text-[12px] text-critical">
                  <X className="size-3.5" /> <span className="line-through decoration-critical/60">pay 12 USDC</span> <span className="ml-auto text-[10.5px] text-critical/70">over 10 cap</span>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-[10px] bg-mint/70 px-2.5 py-2 font-mono text-[12px] text-accent">
                  <Check className="size-3.5" /> ask you · 5 USDC <span className="ml-auto text-[10.5px] text-accent/70">waiting</span>
                </div>
                <div className="mt-3 text-[12px] text-ink-3">one rule held · nothing paid yet</div>
              </MockCard>
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/60"><span className="font-semibold text-ink">Asks before it spends.</span> Your limits are enforced in code. Anything over them is blocked; everything else waits for your yes.</p>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

/* ───────────── Guardrails ───────────── */

const POLICY = [
  ["goal", "20 qualified customers in 14 days"],
  ["budget", "100 USDC for this mission"],
  ["ask first", "every payment, until you say otherwise"],
  ["daily limit", "10 USDC before more approvals"],
  ["hard ceiling", "10 USDC per payment"],
  ["never", "pay without a named recipient and a reason"],
];

export function Guardrails() {
  return (
    <Section id="controls">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <Eyebrow>Your rules</Eyebrow>
          <Headline>
            Your limits aren&apos;t suggestions.
            <br />
            They&apos;re code.
          </Headline>
          <Lede>The spend policy is checked by a plain rules engine on every payment — not by a prompt. This illustrative cycle shows a blocked payment and a request for your approval.</Lede>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Reveal className="window">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5 font-mono text-[12px] text-ink-4">
              <span><span className="text-ink-2">spend-policy</span> · yourshop.com</span>
              <span>example · v3</span>
            </div>
            <div className="py-2 font-mono text-[13px]">
              {POLICY.map(([k, v], i) => (
                <div key={k} className="stagger grid grid-cols-[34px_100px_minmax(0,1fr)_auto] items-center gap-2 px-5 py-2" style={stagger(i)}>
                  <span className="text-right text-ink-4">{i + 1}</span>
                  <span className="text-ink-3">{k}</span>
                  <span className="truncate text-ink">{v}</span>
                  <span className="hidden text-[11px] text-ink-4 sm:block">your rule</span>
                </div>
              ))}
              <div className="stagger mt-1 grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 bg-critical/[0.06] px-5 py-2.5 text-critical" style={stagger(6)}>
                <Minus className="ml-auto size-3.5" />
                <span className="truncate"><span className="line-through decoration-critical/50">pay @bigaccount 12 USDC</span></span>
                <span className="text-[11px]">blocked · over 10 cap</span>
              </div>
              <div className="stagger grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 bg-mint/60 px-5 py-2.5 text-accent" style={stagger(7)}>
                <Plus className="ml-auto size-3.5" />
                <span className="truncate">ask you: 5 USDC to @thebrewguide</span>
                <span className="text-[11px]">waiting for your yes</span>
              </div>
            </div>
            <div className="border-t border-line px-5 py-3.5 text-[12.5px] text-ink-3">Two requests, one cycle. One was stopped by a rule; the other is waiting for you.</div>
          </Reveal>
          <div className="grid gap-5">
            <Reveal delay={120} className="rounded-[22px] bg-surface p-7 ring-1 ring-line shadow-[var(--shadow-card)]">
              <div className="display text-[64px] leading-none text-accent">0</div>
              <div className="mt-3 text-[16px] font-semibold text-ink">payments allowed above the 10 USDC cap</div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">Each one names who, how much and why. It is paid within the limits you set, or it is not paid at all.</p>
            </Reveal>
            <Reveal delay={200} className="rounded-[22px] bg-[#f5f5f4] p-7">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink"><ShieldCheck className="size-4 text-accent" /> Nothing is guessed at</div>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-3">If the operator can&apos;t tell exactly who a payment is for, it stops and asks instead of paying the wrong person. You can freeze the wallet at any time.</p>
            </Reveal>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ───────────── Creator shortlist ───────────── */

const CREATORS = [
  { h: "thebrewguide", p: "YouTube", on: 8, fit: 91, cost: 5, last: "2 days ago" },
  { h: "morningpour", p: "Bluesky", on: 7, fit: 86, cost: 4, last: "today" },
  { h: "homeroastnotes", p: "Reddit", on: 9, fit: 84, cost: 3, last: "yesterday" },
  { h: "kettleandco", p: "YouTube", on: 6, fit: 77, cost: 8, last: "4 days ago" },
  { h: "cuppingclub", p: "Reddit", on: 5, fit: 70, cost: 2, last: "last week" },
];

export function Shortlist() {
  return (
    <Section id="creators" className="bg-[#f5f5f4]">
      <div className="mx-auto max-w-[1100px] px-5 sm:px-8">
        <Reveal className="text-center">
          <Eyebrow>Creators</Eyebrow>
          <Headline center>
            It knows who your customers
            <br />
            already listen to.
          </Headline>
          <Lede center>Not a list of big accounts — the people who keep posting about your space, with the reasons they fit and a first message you can send yourself.</Lede>
        </Reveal>
        <Reveal delay={80} className="mx-auto mt-12 grid max-w-[900px] gap-8 text-left sm:grid-cols-3">
          {[
            ["Real posts, not reach", "Scored on what they publish: topic, recency, engagement quality and authenticity."],
            ["Contacts they publish", "Only the email or site a creator lists on their own profile. Nothing scraped."],
            ["You send the message", "GrowTendril drafts it. It never messages anyone on your behalf."],
          ].map(([t, d], i) => (
            <div key={t} className="stagger" style={stagger(i)}>
              <div className="text-[15px] font-semibold text-ink">{t}</div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{d}</p>
            </div>
          ))}
        </Reveal>
        <Reveal delay={160} className="window mt-12">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <span className="flex items-center gap-2 font-mono text-[12px] text-ink-2">
              <LogoMark size={14} className="text-accent" /> creator shortlist <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-3 ring-1 ring-line">5 creators</span>
            </span>
            <span className="font-mono text-[11.5px] text-ink-4">example · yourshop.com</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
                  <th className="px-5 py-3 font-normal">Creator</th>
                  <th className="px-3 py-3 font-normal">On topic</th>
                  <th className="px-3 py-3 font-normal">Fit</th>
                  <th className="px-3 py-3 font-normal">Est. cost</th>
                  <th className="px-5 py-3 font-normal">Last post</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {CREATORS.map((c, i) => (
                  <tr key={c.h} className="stagger border-t border-line transition-colors hover:bg-surface-2/60" style={stagger(i)}>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-3">
                        <span className="grid size-7 place-items-center rounded-[8px] bg-surface-2 text-[11px] text-ink-3 ring-1 ring-line">{c.h[0]}</span>
                        <span className="text-ink">@{c.h}</span>
                        <span className="font-sans text-[12px] text-ink-4">{c.p}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex gap-1" title={`${c.on} of the last 10 posts are on topic`}>
                        {Array.from({ length: 10 }, (_, j) => <span key={j} className={cn("size-1.5 rounded-full", j < c.on ? "bg-leaf" : "bg-surface-3")} />)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-ink">{c.fit}</td>
                    <td className="px-3 py-3.5 text-ink-3">{c.cost} USDC</td>
                    <td className="px-5 py-3.5 text-ink-3">{c.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── Receipts ───────────── */

export function Receipts() {
  const rows = [
    ["For", "one review video"],
    ["Paid to", "@thebrewguide"],
    ["Amount", "5.00 USDC"],
    ["Approved by", "you · 09:14"],
    ["Policy", "v3 · within budget"],
    ["Network", "Arc"],
  ];
  return (
    <Section id="receipts">
      <div className="mx-auto max-w-[1100px] px-5 text-center sm:px-8">
        <Reveal>
          <Eyebrow>Receipts</Eyebrow>
          <Headline center>
            Every dollar leaves
            <br />a receipt.
          </Headline>
          <Lede center>Who was paid, how much, why, who approved it and what happened next — kept with the experiment so you can judge it later.</Lede>
        </Reveal>
        <Reveal delay={100} className="mx-auto mt-12 flex max-w-[460px] items-center justify-between font-mono text-[13px]">
          <span className="text-center"><span className="block text-ink">you</span><span className="text-[11px] text-ink-4">approve once</span></span>
          <span className="mx-3 h-px flex-1 border-t border-dashed border-line-strong" />
          <ArrowRight className="size-4 text-ink-4" />
          <span className="mx-3 h-px flex-1 border-t border-dashed border-line-strong" />
          <span className="text-center"><span className="block text-ink">@thebrewguide</span><span className="text-[11px] text-ink-4">gets paid in USDC</span></span>
        </Reveal>
        <Reveal delay={180} className="relative mx-auto mt-8 max-w-[460px] rounded-[18px] bg-[#f5f5f4] text-left font-mono ring-1 ring-line">
          <span className="absolute -right-3 top-6 rotate-12 rounded-[8px] border-2 border-accent/60 px-2.5 py-1 text-[12px] font-semibold tracking-[0.18em] text-accent/80">EXAMPLE</span>
          <div className="px-6 pb-4 pt-6 text-center text-[11px] uppercase tracking-[0.14em] text-ink-4">GrowTendril · payment receipt</div>
          <dl className="space-y-3 px-6 pb-6 text-[13px]">
            {rows.map(([k, v], i) => (
              <div key={k} className="stagger flex justify-between gap-4" style={stagger(i)}>
                <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-4">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="relative border-t border-dashed border-line-strong">
            <span className="absolute -left-2.5 -top-2.5 size-5 rounded-full bg-surface" />
            <span className="absolute -right-2.5 -top-2.5 size-5 rounded-full bg-surface" />
          </div>
          <div className="px-6 py-5">
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-4">Measured after 7 days</div>
            <div className="mt-1.5 text-[13px] text-accent">31 tracked visits · 4 first orders</div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── Live counts (real, from the database) ───────────── */

export function LiveCounts({ items }: { items: [string, string | number][] }) {
  return (
    <Section>
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal>
          <Eyebrow>Counted, not claimed</Eyebrow>
          <Headline>Live from this deployment.</Headline>
        </Reveal>
        <Reveal delay={100} className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map(([label, value], i) => (
            <div key={label} className="stagger rounded-[22px] bg-[#f5f5f4] p-7" style={stagger(i)}>
              <div className="display text-[clamp(2.6rem,5vw,4rem)] leading-none text-accent">{value}</div>
              <div className="mt-3 text-[14px] text-ink-3">{label}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── Pricing ───────────── */

export function Pricing({ startHref, signedIn }: { startHref: string; signedIn: boolean }) {
  return (
    <Section id="pricing" className="bg-[#f5f5f4]">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="text-center">
          <Eyebrow>Pricing</Eyebrow>
          <Headline center>
            Pay for what runs.
            <br />
            Nothing else.
          </Headline>
          <Lede center>No subscription and no seats. Top up USDC on Arc — from {MIN_TOPUP_USDC} USDC — and each service takes its fixed price when it runs. Credit never expires.</Lede>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {SERVICE_KEYS.map((k, i) => {
            const dark = i === 0;
            return (
              <Reveal key={k} delay={i * 90} className={cn("lift group relative flex flex-col rounded-[26px] p-8", dark ? "bg-ink text-white" : "bg-white ring-1 ring-line")}>
                {dark && <span className="absolute right-6 top-6 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium">Most used</span>}
                <div className={cn("text-[14px] font-medium", dark ? "text-white/80" : "text-ink-2")}>{SERVICES[k].name}</div>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className={cn("display display-bounce text-[72px] leading-none", dark ? "text-leaf" : "text-ink")}>{SERVICES[k].priceUsdc}</span>
                  <span className={cn("text-[14px]", dark ? "text-white/60" : "text-ink-3")}>USDC {SERVICES[k].unit}</span>
                </div>
                <p className={cn("mt-5 flex-1 text-[14px] leading-relaxed", dark ? "text-white/70" : "text-ink-3")}>{SERVICES[k].blurb}</p>
              </Reveal>
            );
          })}
        </div>
        <Reveal delay={120} className="mt-5 flex flex-col gap-6 rounded-[26px] bg-white p-8 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[14px] font-semibold text-ink">Always free</div>
            <ul className="mt-3 grid gap-2.5 text-[14px] text-ink-2 sm:grid-cols-2 sm:gap-x-10">
              {["Unlimited workspaces and teammates", "Evidence, customers and creators to browse", "The growth plan and every export", "Failed services refunded automatically"].map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-mint text-accent"><Check className="size-3" strokeWidth={3} /></span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <Link href={startHref} className="btn-sheen inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[14px] font-medium text-white transition-transform hover:-translate-y-0.5">
            {signedIn ? "Open workspace" : "Start free, top up later"}
            <ArrowRight className="size-4" />
          </Link>
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── On your terms ───────────── */

export function Terms() {
  const cards = [
    {
      title: "Asks first",
      body: "Every payment asks by default. You can allow limited research purchases. Creator payouts always ask, and every payment is capped at 10 USDC.",
      mock: (
        <div className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2 font-mono text-[12px]">
          approval required <span className="flex h-5 w-9 items-center justify-end rounded-full bg-accent p-0.5"><span className="size-4 rounded-full bg-white" /></span>
        </div>
      ),
    },
    {
      title: "USDC on Arc",
      body: "Top-ups and payouts settle in USDC on Arc, checked on-chain. No card on file, no invoices to chase.",
      mock: (
        <div className="space-y-1.5 font-mono text-[12px]">
          {[["network", "Arc"], ["asset", "USDC"]].map(([k, v]) => <div key={k} className="flex justify-between rounded-[10px] bg-surface-2 px-3 py-1.5"><span className="text-ink-4">{k}</span><span>{v}</span></div>)}
        </div>
      ),
    },
    {
      title: "Freeze any time",
      body: "One switch stops the wallet. Nothing moves until you turn it back on — scans and reports keep working.",
      mock: (
        <div className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2 font-mono text-[12px]">
          wallet <span className="flex items-center gap-1 rounded-full bg-s1/10 px-2 py-0.5 text-s1"><Snowflake className="size-3" /> frozen</span>
        </div>
      ),
    },
    {
      title: "No subscription",
      body: "Pay per scan, report or brief. When the balance runs out, autopilot simply waits for you.",
      mock: (
        <div className="rounded-[10px] bg-surface-2 px-3 py-2 font-mono text-[12px]">
          <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-ink-4"><Coins className="size-3" /> balance</span><span>10.00 USDC</span></div>
          <div className="mt-1 text-[11px] text-ink-4">credit never expires</div>
        </div>
      ),
    },
  ];
  return (
    <Section id="terms" className="bg-[#f5f5f4]">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="text-center">
          <Eyebrow>On your terms</Eyebrow>
          <Headline center>You stay in charge.</Headline>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <div className="lift grid h-[150px] place-items-center rounded-[22px] bg-white p-6 ring-1 ring-black/[0.04]">
                <div className="w-full max-w-[220px] rounded-[14px] bg-white p-2.5 shadow-[0_0_0_1px_rgb(10_11_12/0.06),0_14px_30px_-20px_rgb(10_11_12/0.4)]">{c.mock}</div>
              </div>
              <div className="mt-5 text-[15px] font-semibold text-ink">{c.title}</div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{c.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ───────────── FAQ ───────────── */

const FAQ = [
  ["Does it spend money on its own?", "Every payment asks by default and names its recipient, amount, chain and reason. You can enable limited research and service purchases in Settings. Creator payments always need approval. The launch cap is 10 USDC per payment; mission budgets still apply, and exceeding the daily limit asks for approval."],
  ["What kinds of products does it work for?", "Shops, apps, services, software and developer tools. It learns your customers and market from your site and a short profile, then listens in the places they talk."],
  ["Where does the evidence come from?", "Public sources you connect or that need no key. Every claim links back to the post, page or profile it came from so you can judge it yourself."],
  ["How are payments made?", "In USDC on Arc through a wallet your workspace controls. You can freeze it at any time."],
  ["Can my team use it too?", "Yes. Invite teammates with viewer, operator or admin roles. Approvals and settings respect those roles."],
  ["What happens when my balance runs out?", "Nothing is lost. Scans and reports pause — autopilot included — until you top up again, and everything you have already found stays available."],
  ["Is there a subscription?", "No. You top up USDC on Arc whenever you like and each service takes its fixed price when it runs. Credit never expires."],
];

export function Faq() {
  return (
    <Section id="faq">
      <div className="mx-auto grid max-w-[1180px] gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <Reveal>
          <Eyebrow>Questions</Eyebrow>
          <Headline>
            Things people
            <br />
            ask first.
          </Headline>
          <p className="hand mt-6 -rotate-2 text-[18px] text-ink/50">…and the honest answers.</p>
        </Reveal>
        <Reveal delay={100} className="space-y-2.5">
          {FAQ.map(([q, a], i) => (
            <details key={q} className="stagger group rounded-[18px] bg-[#f5f5f4] px-6 py-5 transition-colors open:bg-white open:ring-1 open:ring-line open:shadow-[var(--shadow-card)] [&_summary::-webkit-details-marker]:hidden" style={stagger(i)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink">
                {q}
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white ring-1 ring-line transition-transform duration-300 group-open:rotate-180">
                  <ChevronDown className="size-4 text-ink-3" />
                </span>
              </summary>
              <p className="mt-3 max-w-xl animate-fade-in text-[14.5px] leading-[1.7] text-ink-3">{a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

/* ───────────── Finale ───────────── */

export function Finale({ startHref, signedIn }: { startHref: string; signedIn: boolean }) {
  return (
    <div className="px-3 pb-3 sm:px-5 sm:pb-5">
      <section className="finale-glow rounded-[40px] px-5 pb-32 pt-24 text-center ring-1 ring-line sm:pb-40">
        <Reveal>
          <div className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-ink-4">For shops, apps, services and software</div>
          <h2 className="display display-bounce mx-auto mt-6 text-[clamp(2.4rem,5.4vw,4.4rem)] leading-[1.08] text-ink">
            Ready to grow
            <br />
            <RotatingWord words={["a coffee shop?", "a yoga studio?", "an app?", "a dev tool?", "a bakery?", "a SaaS?", "your idea?"]} className="text-accent" />
          </h2>
          <p className="mx-auto mt-5 max-w-[480px] text-[17px] leading-relaxed text-ink/60">Paste your website. GrowTendril reads it, finds who is asking, and brings you the first experiment.</p>
          <div className="mx-auto mt-9 flex w-fit max-w-full items-center gap-3 rounded-full bg-white py-2 pl-5 pr-2 shadow-[0_0_0_1px_rgb(10_11_12/0.08),0_18px_40px_-20px_rgb(10_11_12/0.35)]">
            <span className="truncate font-mono text-[13.5px] text-ink-3">yourbusiness.com</span>
            <Link href={startHref} className="btn-sheen inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 text-[13.5px] font-medium text-white transition-transform hover:-translate-y-px">
              {signedIn ? "Open workspace" : "Start free"} <ArrowRight className="size-4" />
            </Link>
          </div>
          <p className="mt-5 text-[13px] text-ink/55">No subscription. Top up from {MIN_TOPUP_USDC} USDC when you want to run a scan.</p>
        </Reveal>
      </section>
    </div>
  );
}

/* ───────────── Footer ───────────── */

export function Footer({ startHref, signedIn }: { startHref: string; signedIn: boolean }) {
  const cols: [string, [string, string][]][] = [
    ["Product", [["What it does", "#product"], ["How a cycle works", "#how"], ["Creators", "#creators"], ["Pricing", "#pricing"]]],
    ["Trust", [["Your rules", "#controls"], ["Receipts", "#receipts"], ["On your terms", "#terms"], ["Questions", "#faq"]]],
    ["Account", signedIn ? [["Open workspace", "/app"]] : [["Sign in", "/login"], ["Create account", "/signup"], ["Start a mission", startHref]]],
  ];
  return (
    <footer className="mx-auto max-w-[1180px] px-5 pb-12 pt-16 sm:px-8">
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo grow />
          <p className="mt-4 max-w-[260px] text-[14px] leading-relaxed text-ink-3">Your growth operator. Evidence in, bounded action out, and a receipt for every move.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <div className="text-[13px] text-ink-4">{title}</div>
            <ul className="mt-4 space-y-2.5 text-[14px] text-ink-2">
              {links.map(([label, href]) => (
                <li key={label}>{href.startsWith("#") ? <a href={href} className="transition-colors hover:text-accent">{label}</a> : <Link href={href} className="transition-colors hover:text-accent">{label}</Link>}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[13px] text-ink-4">
        <span>© {new Date().getFullYear()} GrowTendril</span>
        <span className="hand text-[15px]">A tendril finds the next hold, so the plant never has to guess.</span>
      </div>
    </footer>
  );
}
