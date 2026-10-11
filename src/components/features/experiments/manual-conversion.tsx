"use client";
import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { recordManualConversionAction } from "@/server/actions/growth";
import { Button, Field, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";

/** Log conversions by hand (a phone order, a booking, a customer who quoted the code). */
export function ManualConversionForm({ experimentId, defaultEvent, events }: { experimentId: string; defaultEvent: string; events: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(recordManualConversionAction.bind(null, experimentId), null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Recorded");
      form.current?.reset();
      router.refresh();
    } else toast.error("Couldn’t record", state.error);
  }, [state, router]);
  return (
    <form ref={form} action={action} onSubmit={keepValues(action)} className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
        <Field label="Event" htmlFor={`mc-event-${experimentId}`}>
          <Select id={`mc-event-${experimentId}`} name="event" defaultValue={defaultEvent}>
            {events.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Count" htmlFor={`mc-count-${experimentId}`}>
          <Input id={`mc-count-${experimentId}`} name="count" type="number" required min={1} max={500} step={1} defaultValue="1" inputMode="numeric" className="num" />
        </Field>
      </div>
      <Field label="Total value (optional)" htmlFor={`mc-value-${experimentId}`} hint="Revenue from these conversions, in USD">
        <Input id={`mc-value-${experimentId}`} name="value" type="number" min={0} step="0.000001" inputMode="decimal" placeholder="0.00" className="num" />
      </Field>
      <Field label="Note (optional)" htmlFor={`mc-note-${experimentId}`}>
        <Input id={`mc-note-${experimentId}`} name="note" maxLength={300} placeholder="e.g. 3 orders quoted the code at checkout" />
      </Field>
      <Button type="submit" size="sm" icon={<Plus />} loading={pending} className="w-full">
        Record conversion
      </Button>
    </form>
  );
}
