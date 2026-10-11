"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, PlayCircle } from "lucide-react";
import { enterDemoAction, loginAction, signupAction } from "@/server/actions/auth";
import { Button, Callout, Field, Input } from "@/components/ui";

function Hidden({ invite, next }: { invite?: string; next?: string }) {
  return (
    <>
      {invite && <input type="hidden" name="invite" value={invite} />}
      {next && <input type="hidden" name="next" value={next} />}
    </>
  );
}

export function LoginForm({ invite, next, email }: { invite?: string; next?: string; email?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3.5">
      <Hidden invite={invite} next={next} />
      <Field label="Email" htmlFor="login-email">
        <Input id="login-email" name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="you@company.com" className="h-9" autoFocus />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <Input id="login-password" name="password" type="password" required minLength={8} autoComplete="current-password" placeholder="••••••••" className="h-9" />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        {invite ? "Sign in & accept invite" : "Sign in"}
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}

export function SignupForm({ invite, email }: { invite?: string; email?: string }) {
  const [state, action, pending] = useActionState(signupAction, null);
  return (
    <form action={action} className="space-y-3.5">
      <Hidden invite={invite} />
      <Field label="Name" htmlFor="signup-name">
        <Input id="signup-name" name="name" autoComplete="name" placeholder="Ada Lovelace" className="h-9" autoFocus />
      </Field>
      <Field label="Work email" htmlFor="signup-email" hint={invite && email ? "The invite is for this address." : undefined}>
        <Input id="signup-email" name="email" type="email" required autoComplete="email" defaultValue={email} readOnly={!!(invite && email)} placeholder="you@company.com" className="h-9" />
      </Field>
      <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
        <Input id="signup-password" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" className="h-9" />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        {invite ? "Create account & join" : "Create account"}
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}

function DemoSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="lg" className="w-full" loading={pending} icon={<PlayCircle />}>
      {pending ? "Preparing a private demo…" : "Explore the live demo"}
    </Button>
  );
}

/** A private, seeded demo workspace — no keys or account needed. */
export function DemoButton() {
  return (
    <form action={enterDemoAction}>
      <DemoSubmit />
    </form>
  );
}
