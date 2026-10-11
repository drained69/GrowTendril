"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { setExperimentRecipientAction } from "@/server/actions/growth";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";

/** Who a non-creator experiment pays: a writer, a community, a bounty winner. */
export function RecipientForm({ experimentId, address, label, disabled }: { experimentId: string; address: string | null; label: string | null; disabled?: boolean }) {
  const [state, action, pending] = useActionState(setExperimentRecipientAction.bind(null, experimentId), null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      router.refresh();
    } else toast.error("Couldn’t save the recipient", state.error);
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)} className="space-y-2.5">
      <fieldset disabled={disabled || pending} className="space-y-2.5">
        <Field label="Who gets paid" htmlFor={`rcp-label-${experimentId}`} hint="A writer, a community, a bounty winner…">
          <Input id={`rcp-label-${experimentId}`} name="label" defaultValue={label ?? ""} maxLength={80} placeholder="e.g. Sam, food writer" />
        </Field>
        <Field label="Their USDC address on Arc" htmlFor={`rcp-address-${experimentId}`} hint="0x… — ask them for it. Payments still go through your spending rules.">
          <Input id={`rcp-address-${experimentId}`} name="address" defaultValue={address ?? ""} placeholder="0x…" spellCheck={false} autoComplete="off" className="num text-[12px]" required />
        </Field>
        {state && !state.ok && <p className="text-[12px] text-critical">{state.error}</p>}
        <Button type="submit" size="sm" icon={<Wallet />} loading={pending} className="w-full">
          {address ? "Update recipient" : "Save recipient"}
        </Button>
      </fieldset>
    </form>
  );
}
