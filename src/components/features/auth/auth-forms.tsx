"use client";
import { useActionState, useState, useTransition } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { forgotPasswordAction, loginAction, resendCodeAction, resetPasswordAction, signupAction, verifyEmailAction } from "@/server/actions/auth";
import { toast } from "@/components/ui/toast";
import { Button, Callout, Field, Input } from "@/components/ui";
import { keepValues } from "@/components/ui/submit";

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
    <form action={action} onSubmit={keepValues(action)} className="space-y-3.5">
      <Hidden invite={invite} next={next} />
      <Field label="Email" htmlFor="login-email">
        <Input id="login-email" name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="you@company.com" className="h-11" autoFocus />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <Input id="login-password" name="password" type="password" required minLength={8} autoComplete="current-password" placeholder="••••••••" className="h-11" />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        {invite ? "Sign in & accept invite" : "Sign in"}
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}

export function SignupForm({ invite, email, next }: { invite?: string; email?: string; next?: string }) {
  const [state, action, pending] = useActionState(signupAction, null);
  return (
    <form action={action} onSubmit={keepValues(action)} className="space-y-3.5">
      <Hidden invite={invite} next={next} />
      <Field label="Name" htmlFor="signup-name">
        <Input id="signup-name" name="name" autoComplete="name" placeholder="Ada Lovelace" className="h-11" autoFocus />
      </Field>
      <Field label="Work email" htmlFor="signup-email" hint={invite && email ? "Must match the address the invite was sent to." : undefined}>
        <Input id="signup-email" name="email" type="email" required autoComplete="email" defaultValue={email} readOnly={!!(invite && email)} placeholder="you@company.com" className="h-11" />
      </Field>
      <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
        <Input id="signup-password" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" className="h-11" />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        {invite ? "Create account & join" : "Create account"}
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}

/** "Continue with Google": a plain link, so it works before the page has hydrated. */
export function GoogleButton({ invite, next, label = "Continue with Google" }: { invite?: string; next?: string; label?: string }) {
  const q = new URLSearchParams();
  if (invite) q.set("invite", invite);
  if (next) q.set("next", next);
  return (
    <a
      href={`/api/auth/google${q.size ? `?${q}` : ""}`}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-surface text-[14px] font-medium text-ink shadow-[0_0_0_1px_rgb(10_11_12/0.12),0_1px_2px_rgb(10_11_12/0.05)] transition-[transform,background-color] hover:-translate-y-px hover:bg-surface-2"
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.2 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.2 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
      </svg>
      {label}
    </a>
  );
}

export function VerifyForm({ email, invite, next }: { email: string; invite?: string; next?: string }) {
  const [state, action, pending] = useActionState(verifyEmailAction, null);
  const [sending, start] = useTransition();
  const [sentAt, setSentAt] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <form action={action} onSubmit={keepValues(action)} className="space-y-3.5">
        <Hidden invite={invite} next={next} />
        <Field label="6-digit code" htmlFor="verify-code" hint={`Sent to ${email}. It expires in 10 minutes.`}>
          <Input
            id="verify-code"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="123456"
            className="num h-11 text-center text-[20px] tracking-[0.4em]"
            autoFocus
          />
        </Field>
        {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending} icon={<MailCheck />}>
          Confirm email
        </Button>
      </form>
      <p className="text-center text-[12px] text-ink-3">
        No email? Check spam, or{" "}
        <button
          type="button"
          disabled={sending}
          className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await resendCodeAction();
              if (r.ok) {
                setSentAt(Date.now());
                toast.success(r.message ?? "New code sent");
              } else toast.error("Couldn’t send a new code", r.error);
            })
          }
        >
          {sending ? "sending…" : "send a new code"}
        </button>
        {sentAt ? " — sent." : "."}
      </p>
    </div>
  );
}

export function ForgotForm({ email }: { email?: string }) {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  return (
    <form action={action} onSubmit={keepValues(action)} className="space-y-3.5">
      <Field label="Email" htmlFor="forgot-email">
        <Input id="forgot-email" name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="you@company.com" className="h-11" autoFocus />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Email me a reset code
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}

export function ResetForm({ email }: { email?: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} onSubmit={keepValues(action)} className="space-y-3.5">
      <Field label="Email" htmlFor="reset-email">
        <Input id="reset-email" name="email" type="email" required autoComplete="email" defaultValue={email} className="h-11" />
      </Field>
      <Field label="6-digit code" htmlFor="reset-code" hint="From the email we just sent. It expires in 10 minutes.">
        <Input id="reset-code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" className="num h-10 tracking-[0.3em]" autoFocus />
      </Field>
      <Field label="New password" htmlFor="reset-password" hint="At least 8 characters. Signs you out everywhere else.">
        <Input id="reset-password" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" className="h-11" />
      </Field>
      {state && !state.ok && <Callout tone="danger">{state.error}</Callout>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Set new password
        {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}
