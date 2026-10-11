"use client";
import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveEconomicsAction } from "@/server/actions/campaigns";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";

export interface EconomicsValues {
  customerValue: string;
  grossMarginPct: string;
  acquisitionSharePct: string;
  conversionRatePct: string;
  fixedPaySharePct: string;
  actionBonusSharePct: string;
  minActionsPerCreator: string;
  maxCreators: string;
  testPhaseSharePct: string;
  holdbackDays: string;
}

/** The project's own campaign economics. Every planner figure that isn't measured or typed per campaign comes from here. */
export function EconomicsForm({ v, saved, disabled }: { v: EconomicsValues; saved: boolean; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveEconomicsAction, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      router.refresh();
    } else toast.error("Couldn’t save", state.error);
  }, [state, router]);

  const field = (name: keyof EconomicsValues, label: string, hint: ReactNode, unit: string, optional = false) => (
    <Field label={label} htmlFor={`eco-${name}`} hint={hint}>
      <div className="relative">
        <Input id={`eco-${name}`} name={name} defaultValue={v[name]} inputMode="decimal" placeholder={optional ? "not set" : undefined} className="num pr-14" required={!optional} />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-4">{unit}</span>
      </div>
    </Field>
  );

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="space-y-5 p-4">
        <div>
          <div className="text-[12.5px] font-medium text-ink">What a customer is worth</div>
          <p className="mt-0.5 text-[11.5px] text-ink-3">Used to suggest a max cost per action: value × margin × action→customer rate × acquisition share. Leave a field blank rather than guessing — measured figures replace blanks when there’s enough data.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {field("customerValue", "Customer value", "e.g. first-year revenue. Blank = use the measured average purchase value", "USDC", true)}
            {field("grossMarginPct", "Gross margin", "Can't be measured from events", "%", true)}
            {field("acquisitionSharePct", "Acquisition share", "Share of margin you'll spend to win a customer", "%")}
            {field("conversionRatePct", "Action → customer rate", "Fallback until 30+ linked actions are measured", "%", true)}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-ink">How campaign budgets are planned</div>
          <p className="mt-0.5 text-[11.5px] text-ink-3">Your rules for every new creator campaign. Running campaigns keep the rules they started with.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field("testPhaseSharePct", "Test phase", "Share of the budget released at launch; the rest waits for measured results", "%")}
            {field("fixedPaySharePct", "Max fixed pay", "Share of a creator's ceiling that can be paid for posts and discussion", "%")}
            {field("actionBonusSharePct", "Action bonus", "Bonus per verified action as a share of your max cost per action", "%")}
            {field("minActionsPerCreator", "Actions before results count", "Each creator needs room for this many in the test phase, and must reach it before results-based release", "actions")}
            {field("maxCreators", "Max creators", "Upper bound per campaign (1–25)", "creators")}
            {field("holdbackDays", "Holdback", "Days before a verified action becomes payable, to catch fake or reversed ones", "days")}
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <span className="text-[11.5px] text-ink-3">{state && !state.ok ? <span className="text-critical">{state.error}</span> : saved ? "Saved figures are labelled “Your setting” wherever they’re used." : "Not saved yet — the planner labels these as starting values until you save."}</span>
        <Button type="submit" variant="primary" size="sm" icon={<Save />} loading={pending} disabled={disabled}>
          Save economics
        </Button>
      </div>
    </form>
  );
}
