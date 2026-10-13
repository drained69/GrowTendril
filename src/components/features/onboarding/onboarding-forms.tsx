"use client";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Globe, Loader2, Sparkles } from "lucide-react";
import { onboardAutonomyAction, onboardIcpAction, onboardMissionAction, onboardProductAction, quickStartAction } from "@/server/actions/onboarding";
import { Button, Callout, Field, Input, Textarea, cn } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { templatesFor } from "@/lib/missions";
import { keepValues } from "@/components/ui/submit";
import { autopilotCostLabel, SERVICES } from "@/lib/services";

function StepFooter({ children, error, note }: { children: ReactNode; error?: string | null; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <span className="min-w-0 text-[11.5px] text-ink-3">{error ? <span className="text-critical">{error}</span> : note}</span>
      {children}
    </div>
  );
}

// ───────────────────────────── step 1 ─────────────────────────────

const AUDIENCE_CHOICES = [
  { value: "auto", label: "Let GrowTendril decide", hint: "Detected from your description" },
  { value: "consumers", label: "Consumers", hint: "People, households, shoppers" },
  { value: "businesses", label: "Businesses", hint: "Companies, teams, professionals" },
  { value: "developers", label: "Developers", hint: "Engineers and technical teams" },
];

export function ProductStep() {
  const [state, action, pending] = useActionState(onboardProductAction, null);
  const [audience, setAudience] = useState("auto");
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (state.data?.note) toast.info("Profile drafted", state.data.note);
      router.push("/onboarding");
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product or business name" htmlFor="ob-name" required>
            <Input id="ob-name" name="name" required maxLength={80} placeholder="Crumb & Co." autoFocus />
          </Field>
          <Field label="Website" htmlFor="ob-web">
            <Input id="ob-web" name="website" type="url" placeholder="https://…" />
          </Field>
        </div>
        <Field label="Short description" htmlFor="ob-desc" required hint="What it does, who it's for, and where, if it's local. At least 10 characters.">
          <Textarea id="ob-desc" name="description" required minLength={10} maxLength={2000} rows={3} placeholder="Weekly sourdough delivery for busy families in Austin…" />
        </Field>
        <div>
          <div className="text-[12.5px] font-medium text-ink">Who are your customers?</div>
          <input type="hidden" name="audience" value={audience} />
          <div className="mt-2">
            <AudiencePicker value={audience} onChange={setAudience} />
          </div>
        </div>
        <details className="group rounded-[8px] border border-line">
          <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:text-ink">More public pages to read (optional)</summary>
          <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-2">
            <Field label="Help center or docs" htmlFor="ob-docs">
              <Input id="ob-docs" name="docsUrl" type="url" placeholder="https://help…" />
            </Field>
            <Field label="X account" htmlFor="ob-x">
              <Input id="ob-x" name="xHandle" placeholder="@handle" />
            </Field>
            <Field label="GitHub repository" htmlFor="ob-gh" className="sm:col-span-2" hint="For software products only">
              <Input id="ob-gh" name="githubUrl" type="url" placeholder="https://github.com/org/repo" />
            </Field>
          </div>
        </details>
      </div>
      <StepFooter error={!pending && state && !state.ok ? state.error : null} note="GrowTendril reads only the public pages you list (respecting robots.txt). You can correct everything next.">
        <Button type="submit" variant="primary" size="md" loading={pending} icon={<Sparkles />}>
          {pending ? "Reading public pages…" : "Build product profile"}
        </Button>
      </StepFooter>
    </form>
  );
}

// ───────────────────────────── quick start ─────────────────────────────

function AudiencePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Who are your customers">
      {AUDIENCE_CHOICES.map((a) => (
        <button
          key={a.value}
          type="button"
          role="radio"
          aria-checked={value === a.value}
          onClick={() => onChange(a.value)}
          className={cn("rounded-[8px] border px-3 py-2 text-left transition-colors", value === a.value ? "border-accent bg-accent/10 ring-1 ring-accent/30" : "border-line hover:border-line-strong hover:bg-surface-2")}
        >
          <span className="block text-[12.5px] font-medium text-ink">{a.label}</span>
          <span className="block text-[11px] text-ink-3">{a.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** One link in, a working workspace out. */
export function QuickStartStep() {
  const [state, action, pending] = useActionState(quickStartAction, null);
  const [audience, setAudience] = useState("auto");
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(`${state.data.name} is set up`, `Read ${state.data.pagesRead} page${state.data.pagesRead === 1 ? "" : "s"} · ${state.data.category}`);
      router.push("/app?welcome=quick");
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <div className="space-y-4 p-4">
        <Field label="Your website" htmlFor="qs-url" required hint="GrowTendril reads your public pages (respecting robots.txt) and sets everything up. You can change anything afterwards.">
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
            <Input id="qs-url" name="url" required inputMode="url" autoComplete="url" placeholder="yourbusiness.com" autoFocus className="h-11 pl-9 text-[14px]" disabled={pending} />
          </div>
        </Field>
        <div>
          <div className="mb-2 text-[12.5px] font-medium text-ink">Who are your customers?</div>
          <input type="hidden" name="audience" value={audience} />
          <AudiencePicker value={audience} onChange={setAudience} />
        </div>
        {pending && (
          <div role="status" className="flex items-start gap-2 rounded-[8px] border border-line bg-surface-2/50 p-3 text-[12.5px] text-ink-2">
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />
            <p>Reading your public pages and preparing your product profile, customers, first goal and safe limits. We&apos;ll show the result when setup is complete.</p>
          </div>
        )}
        {!pending && state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      </div>
      <StepFooter note="Payments always ask you first until you raise the limit in Settings.">
        <Button type="submit" variant="primary" size="md" loading={pending} icon={<Sparkles />}>
          {pending ? "Setting things up…" : "Set everything up"}
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

export function MissionStep({ audience, category }: { audience?: string | null; category?: string | null }) {
  const [state, action, pending] = useActionState(onboardMissionAction, null);
  const TEMPLATES = templatesFor(audience, category);
  const [t, setT] = useState(TEMPLATES[0]);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.push(state.data?.done ? "/app/missions" : "/onboarding");
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)}>
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
            <Input id="ms-goal" name="goal" type="number" required min={1} max={1000000} step={1} defaultValue={t.goal} inputMode="numeric" className="num" />
          </Field>
          <Field label="Days" htmlFor="ms-days">
            <Input id="ms-days" name="days" type="number" required min={1} max={180} step={1} defaultValue={t.days} inputMode="numeric" className="num" />
          </Field>
          <Field label="Budget" htmlFor="ms-budget">
            <div className="relative">
              <Input id="ms-budget" name="budget" type="number" required min={0} step="0.000001" defaultValue={t.budget} inputMode="decimal" className="num pr-12" />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
            </div>
          </Field>
        </div>
      </div>
      <StepFooter error={!pending && state && !state.ok ? state.error : null} note="The budget is a ceiling, not a commitment — unspent USDC stays in the wallet.">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          Set mission
          {!pending && <ArrowRight />}
        </Button>
      </StepFooter>
    </form>
  );
}

// ───────────────────────────── step 4 ─────────────────────────────

const LIMITS = [
  { name: "autonomousLimit", label: "Spend on its own up to", d: "0", hint: "Per payment, for research, data and API services from Circle's marketplace. 0 = always ask you first", fixed: false },
  { name: "dailySpend", label: "Daily limit", d: "10", hint: "Above this total in a day, every payment asks you first", fixed: false },
  { name: "hardCeiling", label: "Per-payment hard ceiling", d: "10", hint: "Choose your maximum per payment; approval cannot exceed it. Starts at 10 USDC", fixed: false },
];

export function AutonomyStep({ autopilot, billing }: { autopilot: Record<string, string>; billing?: boolean }) {
  const [state, action, pending] = useActionState(onboardAutonomyAction, null);
  const [cadence, setCadence] = useState("every_6h");
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <div className="divide-y divide-line">
        {LIMITS.map((l) => (
          <div key={l.name} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-4 px-4 py-3">
            <label htmlFor={`au-${l.name}`} className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink">{l.label}</span>
              <span className="block text-[11.5px] text-ink-3">{l.hint}</span>
            </label>
            <div className="relative">
              <Input id={`au-${l.name}`} name={l.name} type="number" min={l.name === "hardCeiling" ? "0.000001" : 0} step="0.000001" defaultValue={l.d} inputMode="decimal" readOnly={l.fixed} aria-readonly={l.fixed} className={cn("num pr-12 text-right", l.fixed && "cursor-not-allowed bg-surface-2 text-ink-3")} />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-4">
        <div className="text-[12.5px] font-medium text-ink">Autopilot</div>
        <p className="text-[11.5px] text-ink-3">
          How often the operator runs a full cycle on its own. You can change this in Settings.
          {billing && <> Each run is one market scan ({SERVICES.scan.priceUsdc} USDC), and runs wait while your balance is too low.</>}
        </p>
        <input type="hidden" name="autopilot" value={cadence} />
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Autopilot cadence">
          {Object.entries(autopilot).map(([k, label]) => {
            const disabled = false;
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
        {billing && <p className={cn("num mt-2 text-[11.5px]", cadence === "hourly" ? "text-warning" : "text-ink-3")}>{autopilotCostLabel(cadence)}</p>}
      </div>

      <div className="grid gap-2 border-t border-line p-4 text-[12px] sm:grid-cols-3">
        <div className="rounded-[8px] border border-good/30 bg-good/[0.04] p-2.5">
          <div className="label text-good">Runs on its own</div>
          <div className="mt-1 text-ink-2">Market research · scoring · growth plan · creator briefs · measuring results · data purchases up to your limit</div>
        </div>
        <div className="rounded-[8px] border border-warning/30 bg-warning/[0.04] p-2.5">
          <div className="label text-warning">Needs your approval</div>
          <div className="mt-1 text-ink-2">Creator payments · bounties · content · anything above your limits</div>
        </div>
        <div className="rounded-[8px] border border-critical/30 bg-critical/[0.04] p-2.5">
          <div className="label text-critical">Forbidden</div>
          <div className="mt-1 text-ink-2">Mass unsolicited messaging · automated DMs, cold email, mentions</div>
        </div>
      </div>

      {!pending && state && !state.ok && (
        <div className="px-4 pb-4">
          <Callout tone="danger">{state.error}</Callout>
        </div>
      )}
      <StepFooter note="Activating queues the first market scan right away.">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          {pending ? "Activating…" : "Activate GrowTendril"}
          {!pending && <ArrowRight />}
        </Button>
      </StepFooter>
    </form>
  );
}
