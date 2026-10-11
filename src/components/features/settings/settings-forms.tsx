"use client";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw, Save, Trash2 } from "lucide-react";
import { saveProfileAction, updatePolicyAction, saveIcpAction, updateWorkspaceAction, setAutopilotAction, reprofileAction, deleteWorkspaceAction } from "@/server/actions/workspace";
import { leaveWorkspaceAction } from "@/server/actions/team";
import type { ActionResult } from "@/server/actions/_common";
import { Badge, Button, Checkbox, Field, Input, Textarea, cn } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

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
    <form action={action}>
      <fieldset disabled={disabled} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Workspace name" htmlFor="ws-name" required className="sm:col-span-2">
          <Input id="ws-name" name="name" defaultValue={w.name} required maxLength={80} />
        </Field>
        <Field label="Website" htmlFor="ws-web" hint="Full URL. Read again when you use “Re-read public pages” on the product profile">
          <Input id="ws-web" name="website" type="url" defaultValue={w.website ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Docs" htmlFor="ws-docs">
          <Input id="ws-docs" name="docsUrl" type="url" defaultValue={w.docsUrl ?? ""} placeholder="https://docs…" />
        </Field>
        <Field label="GitHub repository" htmlFor="ws-gh">
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

const NOTE = "Reference only — not used for discovery or scoring.";

type Profile = { summary: string; category: string; targetUsers: string[]; competitors: string[]; valueProps: string[]; integrations: string[]; useCases: string[]; pricing: string | null; terminology: string[]; keywords: string[] };

export function ProfileForm({ p, disabled }: { p: Profile; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveProfileAction, null);
  useResultToast(state, "Profile saved");
  const list = (name: keyof Profile, label: string, rows = 3, hint?: string) => (
    <Field label={label} htmlFor={`pf-${name}`} hint={hint ?? "One per line"}>
      <Textarea id={`pf-${name}`} name={name} defaultValue={(p[name] as string[]).join("\n")} rows={rows} className="text-[12.5px]" />
    </Field>
  );
  return (
    <form action={action}>
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <Field label="What the product does" htmlFor="pf-summary" hint={NOTE}>
          <Textarea id="pf-summary" name="summary" defaultValue={p.summary} rows={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="pf-category">
            <Input id="pf-category" name="category" defaultValue={p.category} />
          </Field>
          <Field label="Pricing" htmlFor="pf-pricing" hint={`Only if public. ${NOTE}`}>
            <Input id="pf-pricing" name="pricing" defaultValue={p.pricing ?? ""} />
          </Field>
          {list("targetUsers", "Target users")}
          {list("competitors", "Competitors")}
          {list("valueProps", "Value propositions")}
          {list("useCases", "Use cases")}
          {list("integrations", "Integrations", 3, `One per line. ${NOTE}`)}
          {list("terminology", "Important terminology")}
        </div>
        {list("keywords", "Discovery search terms", 4, "One per line — these drive what GrowthOS searches for across every connected source")}
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
    <form action={action}>
      <fieldset disabled={disabled} className="divide-y divide-line">
        {icps.map((i) => (
          <div key={i.id} className="space-y-3 p-4">
            <input type="hidden" name="icpId" value={i.id} />
            <div className="flex items-center gap-2">
              <Badge tone={i.tier === "primary" ? "accent" : "neutral"}>{i.tier}</Badge>
              <span className="label">ideal customer</span>
            </div>
            <Field label="Title" htmlFor={`icp-t-${i.id}`} hint="Note for your team">
              <Input id={`icp-t-${i.id}`} name={`title:${i.id}`} defaultValue={i.title} className="font-medium" />
            </Field>
            <Field label="Description" htmlFor={`icp-d-${i.id}`} hint="Note for your team">
              <Textarea id={`icp-d-${i.id}`} name={`description:${i.id}`} defaultValue={i.description} rows={2} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Company size" htmlFor={`icp-s-${i.id}`} hint="Note — not enforced">
                <Input id={`icp-s-${i.id}`} name={`companySize:${i.id}`} defaultValue={i.companySize ?? ""} placeholder="e.g. 10–200" />
              </Field>
              <Field label="Segments" htmlFor={`icp-g-${i.id}`} hint="Comma-separated. Matched against public posts to score ICP fit">
                <Input id={`icp-g-${i.id}`} name={`segments:${i.id}`} defaultValue={i.segments.join(", ")} />
              </Field>
              <Field label="In-market signals" htmlFor={`icp-n-${i.id}`} hint="Comma-separated. Notes — not yet used in scoring">
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

const CATS = ["research", "services", "bounty", "content", "kol", "community", "treasury"];

type Policy = { maxTransaction: string; dailySpend: string; kolThreshold: string; bountyThreshold: string; hardCeiling: string; autonomous: string[]; approval: string[]; chains: string[]; forbidden: string[]; tokens: string[] };

export function PolicyForm({ p, chains, disabled }: { p: Policy; chains: { id: string; label: string }[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState(updatePolicyAction, null);
  useResultToast(state, "Policy saved");
  const num = (name: keyof Policy, label: string, hint: string) => (
    <Field label={label} htmlFor={`pol-${name}`} hint={hint}>
      <div className="relative">
        <Input id={`pol-${name}`} name={name} defaultValue={p[name] as string} inputMode="decimal" className="num pr-12" />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">USDC</span>
      </div>
    </Field>
  );
  const group = (legend: string, hint: string, children: ReactNode) => (
    <fieldset className="rounded-[8px] border border-line p-3">
      <legend className="px-1 text-[12px] font-medium text-ink-2">{legend}</legend>
      <p className="mb-2 text-[11.5px] text-ink-3">{hint}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>
    </fieldset>
  );
  return (
    <form action={action}>
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Hints mirror evaluatePolicy (src/server/domain/agent/policy.ts). */}
          {num("maxTransaction", "Max autonomous transaction", "Any single spend above this needs approval")}
          {num("dailySpend", "Daily spend", "A spend taking today's total (UTC) above this needs approval; bridges excluded")}
          {num("hardCeiling", "Hard ceiling", "Any single action above this is denied, even with approval")}
          {num("kolThreshold", "Creator payment threshold", "Creator payments above need approval. Only matters if “kol” is autonomous")}
          {num("bountyThreshold", "Bounty threshold", "Bounties above need approval. Only matters if “bounty” is autonomous")}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {group(
            "Autonomous categories",
            "The agent may spend in these without asking — only while every limit above also passes.",
            CATS.map((c) => <Checkbox key={c} name="autonomous" value={c} defaultChecked={p.autonomous.includes(c)} label={c} />),
          )}
          {group(
            "Approval-gated categories",
            "Every spend here lands in the Approval Inbox. A category in neither list is denied.",
            CATS.map((c) => <Checkbox key={c} name="approval" value={c} defaultChecked={p.approval.includes(c)} label={c} />),
          )}
          {group(
            "Allowed chains",
            "At least one. Payments and bridges touching any other chain are denied.",
            chains.map((c) => <Checkbox key={c.id} name="chains" value={c.id} defaultChecked={p.chains.includes(c.id)} label={c.label} />),
          )}
          <div className="rounded-[8px] border border-line p-3 text-[12px]">
            <div className="font-medium text-ink-2">Fixed rules</div>
            <p className="mt-1 text-ink-3">
              Tokens: <span className="num text-ink-2">{p.tokens.join(", ") || "USDC"}</span>
            </p>
            <p className="mt-1 text-ink-3">Always forbidden (not configurable):</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.forbidden.map((f) => (
                <Badge key={f} tone="bad">
                  {f.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
        </div>
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

export function AutopilotControl({ value, labels, disabled, demo }: { value: string; labels: Record<string, string>; disabled?: boolean; demo?: boolean }) {
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
        const blocked = disabled || pending || (demo && k !== "off");
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

// ───────────────────────────── re-profile ─────────────────────────────

export function ReprofileButton({ disabled, reason }: { disabled?: boolean; reason?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="xs"
      variant="secondary"
      icon={<RefreshCw />}
      loading={pending}
      disabled={disabled}
      title={reason}
      onClick={() => {
        if (!window.confirm("Re-read the website, docs and GitHub README and replace this profile with a fresh draft? Your edits to the profile (including search terms) will be overwritten.")) return;
        start(async () => {
          const r = await reprofileAction();
          if (!r.ok) toast.error("Couldn’t re-read pages", r.error);
          else toast.success("Profile redrafted", r.message);
          router.refresh();
        });
      }}
    >
      {pending ? "Reading pages…" : "Re-read public pages"}
    </Button>
  );
}

// ───────────────────────────── delete workspace ─────────────────────────────

export function DeleteWorkspace({ workspace, blocked }: { workspace: string; blocked?: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger" size="sm" icon={<Trash2 />} disabled={!!blocked} title={blocked} onClick={() => setOpen(true)}>
        Delete workspace
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setTyped("");
        }}
        size="sm"
        title={`Delete ${workspace}?`}
        description="Permanently deletes the workspace and everything in it — profile, missions, intelligence, receipts, audit log and memberships. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={typed.trim() !== workspace}
              onClick={() =>
                start(async () => {
                  const r = await deleteWorkspaceAction(typed);
                  if (r && !r.ok) toast.error("Couldn’t delete workspace", r.error);
                })
              }
            >
              Delete forever
            </Button>
          </>
        }
      >
        <Field label={`Type “${workspace}” to confirm`} htmlFor="del-ws">
          <Input id="del-ws" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      </Dialog>
    </>
  );
}
