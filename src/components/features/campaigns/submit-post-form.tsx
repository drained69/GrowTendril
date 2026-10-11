"use client";
import { useActionState, useEffect, useRef, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import type { ActionResult } from "@/server/actions/_common";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";

type SubmitAction = (prev: unknown, form: FormData) => Promise<ActionResult>;

/** Creator submits a link to a published post for review. */
export function SubmitPostForm({ action, platformLabel, disclosureText }: { action: SubmitAction; platformLabel: string; disclosureText: string }) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? "Submitted");
      form.current?.reset();
      router.refresh();
    } else toast.error("Not submitted", state.error);
  }, [state, router]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => dispatch(fd));
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-3">
      <Field label={`Link to your ${platformLabel} post`} htmlFor="sp-url" required hint={`The full https:// link. Make sure the post shows ${disclosureText} (or an equally clear disclosure) before you submit.`}>
        <Input id="sp-url" name="url" type="url" required minLength={8} maxLength={500} placeholder="https://…" spellCheck={false} autoComplete="off" />
      </Field>
      <Field label="Note for the reviewer" htmlFor="sp-note" hint="Optional — context, or where the discussion happened.">
        <Input id="sp-note" name="note" maxLength={400} />
      </Field>
      <div className="flex items-center justify-between gap-3">
        {state && !state.ok ? <p className="text-[12px] text-critical">{state.error}</p> : <span />}
        <Button type="submit" variant="primary" icon={<Send />} loading={pending}>
          Submit post
        </Button>
      </div>
    </form>
  );
}
