"use client";
import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Send } from "lucide-react";
import type { ActionResult } from "@/server/actions/_common";
import { Button, Callout, Checkbox, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { toast } from "@/components/ui/toast";

const EVM = /^0x[0-9a-fA-F]{40}$/;
type JoinAction = (prev: unknown, form: FormData) => Promise<ActionResult<{ accessToken: string }>>;

/** Public application form. On success it shows the private contribution link exactly once. */
export function JoinForm({ action, platforms, disclosureText, origin }: { action: JoinAction; platforms: { value: string; label: string }[]; disclosureText: string; origin: string }) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, start] = useTransition();
  const [address, setAddress] = useState("");
  const addressBad = address.trim().length > 0 && !EVM.test(address.trim());

  useEffect(() => {
    if (state && !state.ok) toast.error("Application not sent", state.error);
  }, [state]);

  if (state?.ok && state.data?.accessToken) {
    const link = `${origin}/creator/${state.data.accessToken}`;
    return (
      <div className="space-y-4 p-4">
        <Callout tone="success" title="Application received">
          The business will review it. Your contribution page shows your status, and once you’re accepted, your tracking link and the form to submit posts.
        </Callout>
        <div className="rounded-[8px] border border-warning/40 bg-warning/[0.07] p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <AlertTriangle className="size-4 text-warning" />
            Save this link now — it is your login
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">There’s no account or password. This private link is the only way back to your posts, scores and rewards. It is shown once and can’t be recovered — bookmark it or store it somewhere safe, and don’t share it.</p>
          <CopyField value={link} className="mt-3" />
        </div>
        <LinkButton href={`/creator/${state.data.accessToken}`} variant="primary" icon={<ArrowRight />} className="w-full">
          Open my contribution page
        </LinkButton>
      </div>
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    // Dispatch manually so a rejected application keeps what was typed.
    e.preventDefault();
    if (addressBad) return toast.error("Check your payout address", "It should be a 0x… address (42 characters).");
    const fd = new FormData(e.currentTarget);
    start(() => dispatch(fd));
  }

  return (
    <form onSubmit={submit} className="space-y-3.5 p-4">
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
        <Field label="Platform" htmlFor="j-provider" required>
          <Select id="j-provider" name="provider" required defaultValue={platforms[0]?.value}>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Handle" htmlFor="j-handle" required>
          <Input id="j-handle" name="handle" required maxLength={64} placeholder="@yourhandle" autoComplete="off" spellCheck={false} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name" htmlFor="j-name">
          <Input id="j-name" name="displayName" maxLength={80} autoComplete="name" />
        </Field>
        <Field label="Contact" htmlFor="j-contact" hint="Optional — email or DM">
          <Input id="j-contact" name="contact" maxLength={120} autoComplete="email" />
        </Field>
      </div>
      <Field label="Payout address" htmlFor="j-address" required error={addressBad ? "Enter a 0x… address (42 characters)" : null} hint="An address you control on Arc. Rewards are only ever sent here.">
        <Input id="j-address" name="payoutAddress" required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" className="num text-[12px]" aria-invalid={addressBad} />
      </Field>
      <Field label="Why you?" htmlFor="j-pitch" hint="Optional — what you’d make and who follows you.">
        <Textarea id="j-pitch" name="pitch" maxLength={600} rows={3} className="text-[12.5px]" />
      </Field>
      <div className="space-y-2 rounded-[8px] border border-line bg-surface-2 p-3">
        <Checkbox name="agreeRules" required label="I’ve read the rules: I’m paid for accepted posts and verified actions up to the stated ceiling, after review." className="items-start [&_input]:mt-0.5" />
        <Checkbox
          name="agreeDisclosure"
          required
          label={
            <span>
              Every paid post will clearly disclose the relationship (e.g. <span className="num text-ink">{disclosureText}</span>).
            </span>
          }
          className="items-start [&_input]:mt-0.5"
        />
      </div>
      <Button type="submit" variant="primary" size="md" icon={<Send />} loading={pending} className="w-full">
        Apply to join
      </Button>
      {state && !state.ok && <p className="text-[12px] text-critical">{state.error}</p>}
    </form>
  );
}
