"use client";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Save } from "lucide-react";
import { saveProfileAction, updatePolicyAction, saveIcpAction, updateWorkspaceAction, setAutopilotAction } from "@/server/actions/workspace";
import { leaveWorkspaceAction } from "@/server/actions/team";
import type { ActionResult } from "@/server/actions/_common";
import { Badge, Button, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { AUDIENCE_LABEL, AUDIENCES } from "@/server/domain/intel/market-taxonomy";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";
import { autopilotCostLabel } from "@/lib/services";

/** Toasts the outcome of a form action once, and refreshes server data on success. */
function useResultToast(state: ActionResult | null, fallback = "Saved") {
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? fallback);
      router.refresh();
    } else toast.error("Couldn’t save", state.error);
  }, [state, router, fallback]);
}

function FormFooter({ pending, label, disabled, note, state }: { pending: boolean; label: string; disabled?: boolean; note?: ReactNode; state: ActionResult | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <span className="text-[11.5px] text-ink-3">{state && !state.ok ? <span className="text-critical">{state.error}</span> : note}</span>
      <Button type="submit" variant="primary" size="sm" icon={<Save />} loading={pending} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

// ───────────────────────────── workspace ─────────────────────────────

type Workspace = { name: string; website: string | null; docsUrl: string | null; githubUrl: string | null; xHandle: string | null };

export function WorkspaceForm({ w, disabled }: { w: Workspace; disabled?: boolean }) {
  const [state, action, pending] = useActionState(updateWorkspaceAction, null);
  useResultToast(state, "Workspace saved");
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <fieldset disabled={disabled} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Workspace name" htmlFor="ws-name" required className="sm:col-span-2">
          <Input id="ws-name" name="name" defaultValue={w.name} required maxLength={80} />
        </Field>
        <Field label="Website" htmlFor="ws-web" hint="Your site, shop or booking page. Tracked campaign links send people here.">
          <Input id="ws-web" name="website" type="url" defaultValue={w.website ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Help center or docs" htmlFor="ws-docs">
          <Input id="ws-docs" name="docsUrl" type="url" defaultValue={w.docsUrl ?? ""} placeholder="https://help…" />
        </Field>
        <Field label="GitHub repository" htmlFor="ws-gh" hint="Software products only">
          <Input id="ws-gh" name="githubUrl" type="url" defaultValue={w.githubUrl ?? ""} placeholder="https://github.com/org/repo" />
        </Field>
        <Field label="X account" htmlFor="ws-x">
          <Input id="ws-x" name="xHandle" defaultValue={w.xHandle ? `@${w.xHandle}` : ""} placeholder="@handle" />
        </Field>
      </fieldset>
      <FormFooter pending={pending} label="Save workspace" disabled={disabled} state={state} note={disabled ? "Only owners can edit the workspace." : undefined} />
    </form>
  );
}

// ───────────────────────────── product profile ─────────────────────────────

type Profile = { summary: string; category: string; audience: string; targetUsers: string[]; competitors: string[]; valueProps: string[]; integrations: string[]; useCases: string[]; pricing: string | null; terminology: string[]; keywords: string[] };

export function ProfileForm({ p, disabled }: { p: Profile; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveProfileAction, null);
  useResultToast(state, "Profile saved");
  const list = (name: keyof Profile, label: string, rows = 3, hint?: string) => (
    <Field label={label} htmlFor={`pf-${name}`} hint={hint ?? "One per line"}>
      <Textarea id={`pf-${name}`} name={name} defaultValue={(p[name] as string[]).join("\n")} rows={rows} className="text-[12.5px]" />
    </Field>
  );
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <Field label="What the product does" htmlFor="pf-summary">
          <Textarea id="pf-summary" name="summary" defaultValue={p.summary} rows={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="pf-category">
            <Input id="pf-category" name="category" defaultValue={p.category} />
          </Field>
          <Field label="Customers" htmlFor="pf-audience" hint="Shapes which sources, missions and wording GrowTendril uses">
            <Select id="pf-audience" name="audience" defaultValue={p.audience}>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pricing" htmlFor="pf-pricing" hint="Only if public">
            <Input id="pf-pricing" name="pricing" defaultValue={p.pricing ?? ""} />
          </Field>
          {list("targetUsers", "Target users")}
          {list("competitors", "Competitors")}
          {list("valueProps", "Value propositions")}
          {list("useCases", "Use cases")}
          {list("integrations", "Integrations")}
          {list("terminology", "Important terminology")}
        </div>
        {list("keywords", "Discovery search terms", 4, "One per line — these drive what GrowTendril searches for across every connected source")}
      </fieldset>
      <FormFooter pending={pending} label="Save profile" disabled={disabled} state={state} />
    </form>
  );
}

// ───────────────────────────── ICP ─────────────────────────────

type Icp = { id: string; tier: string; title: string; description: string; companySize: string | null; segments: string[]; signals: string[] };

export function IcpForm({ icps, disabled }: { icps: Icp[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveIcpAction, null);
  useResultToast(state, "ICP saved");
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <fieldset disabled={disabled} className="divide-y divide-line">
        {icps.map((i) => (
          <div key={i.id} className="space-y-3 p-4">
            <input type="hidden" name="icpId" value={i.id} />
            <div className="flex items-center gap-2">
              <Badge tone={i.tier === "primary" ? "accent" : "neutral"}>{i.tier}</Badge>
              <span className="label">ideal customer</span>
            </div>
            <Field label="Title" htmlFor={`icp-t-${i.id}`}>
              <Input id={`icp-t-${i.id}`} name={`title:${i.id}`} defaultValue={i.title} className="font-medium" />
            </Field>
            <Field label="Description" htmlFor={`icp-d-${i.id}`}>
              <Textarea id={`icp-d-${i.id}`} name={`description:${i.id}`} defaultValue={i.description} rows={2} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Company size" htmlFor={`icp-s-${i.id}`} hint="Leave empty for consumers">
                <Input id={`icp-s-${i.id}`} name={`companySize:${i.id}`} defaultValue={i.companySize ?? ""} placeholder="e.g. 10–200" />
              </Field>
              <Field label="Segments" htmlFor={`icp-g-${i.id}`} hint="Comma-separated">
                <Input id={`icp-g-${i.id}`} name={`segments:${i.id}`} defaultValue={i.segments.join(", ")} />
              </Field>
              <Field label="In-market signals" htmlFor={`icp-n-${i.id}`} hint="Comma-separated">
                <Input id={`icp-n-${i.id}`} name={`signals:${i.id}`} defaultValue={i.signals.join(", ")} />
              </Field>
            </div>
          </div>
        ))}
      </fieldset>
      <FormFooter pending={pending} label="Save ICP" disabled={disabled} state={state} />
    </form>
  );
}

// ───────────────────────────── policy ─────────────────────────────

type Policy = { autonomousLimit: string; dailySpend: string; hardCeiling: string; forbidden: string[]; tokens: string[] };

export function PolicyForm({ p, disabled }: { p: Policy; disabled?: boolean }) {
  const [state, action, pending] = useActionState(updatePolicyAction, null);
  useResultToast(state, "Policy saved");
  const autonomous = Number(p.autonomousLimit) > 0;
  return (
    <form action={action} onSubmit={keepValues(action)}>
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          {autonomous
            ? `GrowTendril buys research, data and API services on its own up to ${p.autonomousLimit} USDC per payment while the day's total stays under the daily limit. Everything else asks you first.`
            : "Every payment asks you first. Set an autonomous limit above 0 to let GrowTendril buy research, data and API services on its own."}{" "}
          Payments to people — creators, bounties, partners — always need your approval, and no payment can exceed the hard ceiling.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Spend on its own up to" htmlFor="pol-autonomousLimit" hint="Per payment, research and services only. 0 = always ask.">
            <Input id="pol-autonomousLimit" name="autonomousLimit" defaultValue={p.autonomousLimit} inputMode="decimal" />
          </Field>
          <Field label="Daily limit" htmlFor="pol-dailySpend" hint="Above this total in a day, every payment asks you.">
            <Input id="pol-dailySpend" name="dailySpend" defaultValue={p.dailySpend} inputMode="decimal" />
          </Field>
          <Field label="Per-payment hard ceiling" htmlFor="pol-hardCeiling" hint="Maximum 10 USDC. Approval can't override it.">
            <Input id="pol-hardCeiling" name="hardCeiling" defaultValue={p.hardCeiling} inputMode="decimal" />
          </Field>
        </div>
        <div className="rounded-[8px] border border-line p-3 text-[12px] text-ink-3">Arc mainnet · {p.tokens.join(", ") || "USDC"} only · no cross-chain transfers. Forbidden actions: {p.forbidden.map((f) => f.replace(/_/g, " ")).join(", ")}.</div>
      </fieldset>
      <FormFooter pending={pending} label="Save policy" disabled={disabled} state={state} note="Changes are versioned and audit-logged." />
    </form>
  );
}

// ───────────────────────────── autopilot ─────────────────────────────

const CADENCE_HELP: Record<string, string> = {
  off: "The operator only runs when someone clicks Run cycle.",
  hourly: "Scan, score and act within policy every hour.",
  every_6h: "Four cycles a day — a good default for most teams.",
  daily: "One cycle per day, before the daily brief.",
};

export function AutopilotControl({ value, labels, disabled, billing }: { value: string; labels: Record<string, string>; disabled?: boolean; billing?: boolean }) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (cadence: string) =>
    start(async () => {
      const prev = current;
      setCurrent(cadence);
      const r = await setAutopilotAction(cadence);
      if (!r.ok) {
        setCurrent(prev);
        toast.error("Couldn’t change autopilot", r.error);
      } else {
        toast.success(r.message ?? "Autopilot updated");
        router.refresh();
      }
    });
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Autopilot cadence">
      {Object.entries(labels).map(([k, label]) => {
        const active = current === k;
        const blocked = disabled || pending;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={blocked}
            onClick={() => !active && set(k)}
            className={cn(
              "rounded-[8px] border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
              active ? "border-accent bg-accent/10 ring-1 ring-accent/30" : "border-line hover:border-line-strong hover:bg-surface-2",
              blocked && !active && "opacity-50",
            )}
          >
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <span className={cn("size-2 rounded-full ring-1", active ? "bg-accent ring-accent" : "ring-line-strong")} />
              {label}
            </span>
            <span className="mt-1 block text-[11.5px] leading-snug text-ink-3">{CADENCE_HELP[k]}</span>
            {billing && <span className={cn("num mt-1.5 block text-[11px]", k === "hourly" ? "text-warning" : "text-ink-4")}>{autopilotCostLabel(k)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── danger zone ─────────────────────────────

export function LeaveWorkspace({ workspace, blocked }: { workspace: string; blocked?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger" size="sm" icon={<LogOut />} disabled={!!blocked} title={blocked} onClick={() => setOpen(true)}>
        Leave workspace
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Leave ${workspace}?`}
        description="You lose access immediately. An admin will need to invite you again to rejoin."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await leaveWorkspaceAction();
                  if (r && !r.ok) toast.error("Couldn’t leave", r.error);
                })
              }
            >
              Leave workspace
            </Button>
          </>
        }
      />
    </>
  );
}
