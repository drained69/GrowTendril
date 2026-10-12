"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveCustomerValueDefinitionsAction } from "@/server/actions/customer-value";
import { Button, Field, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";

/** Activation event, repeat window and gross-margin assumption for every cohort on the page. */
export function DefinitionsForm({ events, activationEvent, repeatWindowDays, marginPct, saved, disabled }: { events: { value: string; label: string }[]; activationEvent: string; repeatWindowDays: number; marginPct: number | null; saved: boolean; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveCustomerValueDefinitionsAction, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      router.refresh();
    } else toast.error("Couldn’t save", state.error);
  }, [state, router]);

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label="Activated means" htmlFor="cv-activation" hint="The event that shows a customer actually got started.">
          <Select id="cv-activation" name="activationEvent" defaultValue={activationEvent}>
            {events.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repeat window" htmlFor="cv-repeat" hint="A second purchase within this many days of the first makes a repeat customer.">
          <div className="relative">
            <Input id="cv-repeat" name="repeatWindowDays" defaultValue={repeatWindowDays} inputMode="numeric" className="num pr-12" required />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">days</span>
          </div>
        </Field>
        <Field label="Gross margin (assumption)" htmlFor="cv-margin" hint="Optional. Only used for estimated gross profit and payback. Shared with Settings → Economics.">
          <div className="relative">
            <Input id="cv-margin" name="grossMarginPct" defaultValue={marginPct ?? ""} inputMode="numeric" placeholder="not set" className="num pr-8" />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">%</span>
          </div>
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <span className="text-[11.5px] text-ink-3">{state && !state.ok ? <span className="text-critical">{state.error}</span> : disabled ? "Only admins and owners can change definitions." : saved ? "Saved for this workspace." : "Starting definitions — not saved yet."}</span>
        <Button type="submit" variant="primary" size="sm" icon={<Save />} loading={pending} disabled={disabled}>
          Save definitions
        </Button>
      </div>
    </form>
  );
}
