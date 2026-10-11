"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { recordDeliveryAction } from "@/server/actions/growth";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";

/** Where the paid work lives. Tranche 2 pays on delivery. */
export function DeliveryForm({ experimentId, url, note, disabled }: { experimentId: string; url: string | null; note: string | null; disabled?: boolean }) {
  const [state, action, pending] = useActionState(recordDeliveryAction.bind(null, experimentId), null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      router.refresh();
    } else toast.error("Couldn’t record the delivery", state.error);
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)} className="space-y-2.5">
      <fieldset disabled={disabled || pending} className="space-y-2.5">
        <Field label="Link to the delivered work" htmlFor={`dlv-url-${experimentId}`} hint="The post, video, article or merged PR you paid for">
          <Input id={`dlv-url-${experimentId}`} name="url" type="url" defaultValue={url ?? ""} placeholder="https://…" spellCheck={false} autoComplete="off" required />
        </Field>
        <Field label="Note (optional)" htmlFor={`dlv-note-${experimentId}`}>
          <Input id={`dlv-note-${experimentId}`} name="note" defaultValue={note ?? ""} maxLength={300} placeholder="e.g. Posted Tuesday, includes the tracked link" />
        </Field>
        <Button type="submit" size="sm" icon={<PackageCheck />} loading={pending} className="w-full">
          {url ? "Update delivery" : "Record delivery"}
        </Button>
      </fieldset>
    </form>
  );
}
