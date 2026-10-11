"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { resolveLedgerExceptionAction } from "@/server/actions/wallet";
import { Button, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { keepValues } from "@/components/ui/submit";

/** Close a ledger exception with a note saying what was found. The books are not changed. */
export function ResolveExceptionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(resolveLedgerExceptionAction.bind(null, id), null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Resolved");
      router.refresh();
    } else toast.error("Couldn’t resolve it", state.error);
  }, [state, router]);
  return (
    <form action={action} onSubmit={keepValues(action)} className="flex gap-2">
      <Input name="resolution" placeholder="What you found, e.g. “Refunded on 12 Oct”" aria-label="Resolution note" required minLength={3} maxLength={500} disabled={pending} className="h-8 flex-1 text-[12px]" />
      <Button type="submit" size="sm" icon={<Check />} loading={pending}>
        Resolve
      </Button>
    </form>
  );
}
