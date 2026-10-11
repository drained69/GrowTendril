"use client";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { onboardAutonomyAction, onboardIcpAction, onboardMissionAction, onboardProductAction } from "@/server/actions/onboarding";
import { Button, Callout, Field, Input, Textarea, cn } from "@/components/ui";
import { toast } from "@/components/ui/toast";

function StepFooter({ children, error, note }: { children: ReactNode; error?: string | null; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <span className="min-w-0 text-[11.5px] text-ink-3">{error ? <span className="text-critical">{error}</span> : note}</span>
      {children}
    </div>
  );
}

// ───────────────────────────── step 1 ─────────────────────────────

export function ProductStep() {
  const [state, action, pending] = useActionState(onboardProductAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (state.data?.note) toast.info("Profile drafted", state.data.note);
      router.push("/onboarding");
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action}>
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" htmlFor="ob-name" required>
            <Input id="ob-name" name="name" required maxLength={80} placeholder="Meterline" autoFocus />
          </Field>
          <Field label="Website" htmlFor="ob-web">
            <Input id="ob-web" name="website" type="url" placeholder="https://…" />
          </Field>
          <Field label="Docs" htmlFor="ob-docs">
            <Input id="ob-docs" name="docsUrl" type="url" placeholder="https://docs…" />
          </Field>
          <Field label="X account" htmlFor="ob-x">
            <Input id="ob-x" name="xHandle" placeholder="@handle" />
          </Field>
          <Field label="GitHub repository" htmlFor="ob-gh" className="sm:col-span-2">
            <Input id="ob-gh" name="githubUrl" type="url" placeholder="https://github.com/org/repo" />
          </Field>
        </div>
        <Field label="Short description" htmlFor="ob-desc" required hint="What it does, and for whom. At least 10 characters.">
          <Textarea id="ob-desc" name="description" required minLength={10} maxLength={2000} rows={3} placeholder="Usage-based billing API for developer tools…" />
        </Field>
      </div>
      <StepFooter error={state && !state.ok ? state.error : null} note="GrowTendril reads only the public pages you list (respecting robots.txt). You can correct everything next.">
        <Button type="submit" variant="primary" size="md" loading={pending} icon={<Sparkles />}>
          {pending ? "Reading public pages…" : "Build product profile"}
        </Button>
      </StepFooter>
    </form>
  );
}

// ───────────────────────────── step 2 ─────────────────────────────

export function GenerateIcp() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      size="md"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await onboardIcpAction();
          if (r.ok) toast.success("ICP proposed", r.message);
          else toast.error("Couldn’t propose an ICP", r.error);
          router.refresh();
        })
      }
    >
      {pending ? "Proposing ICP…" : "Looks right — propose my ICP"}
      {!pending && <ArrowRight />}
    </Button>
  );
}

// ───────────────────────────── step 3 ─────────────────────────────

const TEMPLATES = [
  { key: "first_100_devs", name: "First 100 Developers", goal: 100, days: 14, budget: "500", desc: "Verified SDK users" },
  { key: "find_buyers", name: "Find 20 Buyers", goal: 20, days: 7, budget: "100", desc: "High-intent qualified companies requesting a demo" },
  { key: "own_narrative", name: "Own the Narrative", goal: 1000, days: 30, budget: "300", desc: "Qualified visits from a target narrative" },
  { key: "kol_discovery", name: "KOL Discovery", goal: 30, days: 14, budget: "50", desc: "Signups from validated creator campaigns" },
];

export function MissionStep() {
  const [state, action, pending] = useActionState(onboardMissionAction, null);
  const [t, setT] = useState(TEMPLATES[0]);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.push(state.data?.done ? "/app/missions" : "/onboarding");
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action}>
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Mission template">
          {TEMPLATES.map((x) => {
            const active = t.key === x.key;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={active}
                key={x.key}
                onClick={() => setT(x)}
                className={cn("flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5 text-left transition-colors", active ? "border-accent bg-accent/10 ring-1 ring-accent/30" : "border-line hover:border-line-strong hover:bg-surface-2")}
              >
                <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ring-1 [&_svg]:size-2.5", active ? "bg-accent text-white ring-accent" : "ring-line-strong")}>{active && <Check />}</span>
                <span>
                  <span className="block text-[13px] font-medium text-ink">{x.name}</span>
                  <span className="block text-[11.5px] text-ink-3">{x.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="template" value={t.key} />
        <div className="grid grid-cols-3 gap-3" key={t.key}>
          <Field label="Goal" htmlFor="ms-goal">
            <Input id="ms-goal" name="goal" defaultValue={t.goal} inputMode="numeric" className="num" />
          </Field>
          <Field label="Days" htmlFor="ms-days">
            <Input id="ms-days" name="days" defaultValue={t.days} inputMode="numeric" className="num" />
          </Field>
          <Field label="Budget" htmlFor="ms-budget">
            <div className="relative">
              <Input id="ms-budget" name="budget" defaultValue={t.budget} inputMode="decimal" className="num pr-12" />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
            </div>
          </Field>
        </div>
      </div>
      <StepFooter error={state && !state.ok ? state.error : null} note="The budget is a ceiling, not a commitment — unspent USDC stays in the wallet.">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          Set mission
          {!pending && <ArrowRight />}
        </Button>
      </StepFooter>
    </form>
  );
}

// ───────────────────────────── step 4 ─────────────────────────────

// Hints mirror evaluatePolicy (src/server/domain/agent/policy.ts) — keep them in sync.
const LIMITS = [
  { name: "maxTransaction", label: "Max autonomous transaction", d: "10", hint: "Any single spend above this waits for your approval" },
  { name: "dailySpend", label: "Max daily spend", d: "50", hint: "A spend that would take today's total (UTC) above this waits for approval. Bridges don't count." },
  { name: "kolThreshold", label: "Creator payment approval above", d: "100", hint: "Only matters while creator payments are autonomous; the max transaction limit still applies" },
  { name: "bountyThreshold", label: "Bounty approval above", d: "25", hint: "Only matters while bounties are autonomous; the max transaction limit still applies" },
  { name: "hardCeiling", label: "Hard ceiling", d: "500", hint: "Any single action above this is denied — not even an approval can exceed it" },
];

export const CATEGORY_LABEL: Record<string, string> = {
  research: "Research & data",
  services: "API services",
  bounty: "Developer bounties",
  content: "Content",
  kol: "Creator payments",
  community: "Partner incentives",
  treasury: "Bridges & budget moves",
};
const catList = (cats: string[]) => (cats.length ? cats.map((c) => CATEGORY_LABEL[c] ?? c).join(" · ") : "None");

export function AutonomyStep({ autopilot, demo, autonomous, approval }: { autopilot: Record<string, string>; demo?: boolean; autonomous: string[]; approval: string[] }) {
  const [state, action, pending] = useActionState(onboardAutonomyAction, null);
  const [cadence, setCadence] = useState(demo ? "off" : "every_6h");
  return (
    <form action={action}>
      <div className="divide-y divide-line">
        {LIMITS.map((l) => (
          <div key={l.name} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-4 px-4 py-3">
            <label htmlFor={`au-${l.name}`} className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink">{l.label}</span>
              <span className="block text-[11.5px] text-ink-3">{l.hint}</span>
            </label>
            <div className="relative">
              <Input id={`au-${l.name}`} name={l.name} defaultValue={l.d} inputMode="decimal" className="num pr-12 text-right" />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-4">
        <div className="text-[12.5px] font-medium text-ink">Autopilot</div>
        <p className="text-[11.5px] text-ink-3">How often the operator runs a full cycle on its own. You can change this in Settings.</p>
        <input type="hidden" name="autopilot" value={cadence} />
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Autopilot cadence">
          {Object.entries(autopilot).map(([k, label]) => {
            const disabled = demo && k !== "off";
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={cadence === k}
                disabled={disabled}
                onClick={() => setCadence(k)}
                className={cn("h-7 rounded-[6px] border px-2.5 text-[12px] transition-colors disabled:opacity-40", cadence === k ? "border-accent bg-accent/10 text-ink" : "border-line-strong text-ink-3 hover:text-ink")}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 border-t border-line p-4 text-[12px] sm:grid-cols-3">
        <div className="rounded-[8px] border border-good/30 bg-good/[0.04] p-2.5">
          <div className="label text-good">Autonomous</div>
          <div className="mt-1 text-ink-2">{catList(autonomous)}</div>
          <div className="mt-1 text-[11px] text-ink-3">Within the limits above</div>
        </div>
        <div className="rounded-[8px] border border-warning/30 bg-warning/[0.04] p-2.5">
          <div className="label text-warning">Needs approval</div>
          <div className="mt-1 text-ink-2">{catList(approval)}</div>
          <div className="mt-1 text-[11px] text-ink-3">Plus anything over a limit above</div>
        </div>
        <div className="rounded-[8px] border border-critical/30 bg-critical/[0.04] p-2.5">
          <div className="label text-critical">Forbidden</div>
          <div className="mt-1 text-ink-2">Mass unsolicited messaging · automated DMs, cold email, mentions</div>
          <div className="mt-1 text-[11px] text-ink-3">And any spend above the hard ceiling or outside the mission budget</div>
        </div>
      </div>
      <p className="px-4 pb-3 text-[11.5px] text-ink-3">You can change which categories are autonomous or approval-gated in Settings → Spend policy. A category in neither list is denied.</p>

      {state && !state.ok && (
        <div className="px-4 pb-4">
          <Callout tone="danger">{state.error}</Callout>
        </div>
      )}
      <StepFooter note="Activating queues a first market scan right away — discovery only; it spends nothing.">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          {pending ? "Activating…" : "Activate GrowTendril"}
          {!pending && <ArrowRight />}
        </Button>
      </StepFooter>
    </form>
  );
}
