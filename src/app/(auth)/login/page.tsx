import { safeNext } from "@/server/auth/next-step";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { inviteByToken } from "@/server/domain/workspace/members";
import { ROLE_LABEL, type Role } from "@/server/auth/access";
import { Callout } from "@/components/ui";
import { AuthShell, OrDivider } from "@/components/features/auth/auth-shell";
import { GoogleButton, LoginForm } from "@/components/features/auth/auth-forms";
import { googleConfigured } from "@/server/auth/google";

export const dynamic = "force-dynamic";



const GOOGLE_ERROR: Record<string, string> = {
  google_unavailable: "Google sign-in isn't set up on this deployment. Use your email and password.",
  google_canceled: "Google sign-in was canceled.",
  google_state: "That Google sign-in link expired. Try again.",
  google_failed: "Google sign-in didn't work. Try again, or use your email and password.",
  google_mismatch: "That email is linked to a different Google account.",
  google_rate: "Too many attempts. Wait a minute and try again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string; next?: string; error?: string; signedout?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const user = await currentUser();
  if (user && !user.isGuest) redirect(sp.invite ? `/invite/${encodeURIComponent(sp.invite)}` : (next ?? "/app"));
  const inv = sp.invite ? await inviteByToken(await getDb(), sp.invite) : null;
  const qs = `?${new URLSearchParams({ next: safeNext(sp.next), ...(sp.invite ? { invite: sp.invite } : {}) })}`;

  return (
    <AuthShell
      title={inv ? `Join ${inv.projectName}` : "Sign in to GrowTendril"}
      description={inv ? `Sign in as ${inv.invite.email} to accept your invite as ${ROLE_LABEL[inv.invite.role as Role] ?? inv.invite.role}.` : "Welcome back. Pick up where your operator left off."}
      footer={
        <>
          New to GrowTendril?{" "}
          <Link href={`/signup${qs}`} className="font-medium text-ink hover:text-s1">
            Create an account
          </Link>
        </>
      }
    >
      {sp.invite && !inv && (
        <Callout tone="warn" title="This invite is invalid or has expired" className="mb-5">
          You can still sign in. Ask a workspace admin for a new link.
        </Callout>
      )}
      {sp.error && GOOGLE_ERROR[sp.error] && (
        <Callout tone="danger" className="mb-5">
          {GOOGLE_ERROR[sp.error]}
        </Callout>
      )}
      {sp.signedout && (
        <Callout tone="info" className="mb-5">
          You&apos;re signed out on every device.
        </Callout>
      )}
      {googleConfigured() && (
        <>
          <GoogleButton invite={inv ? sp.invite : undefined} next={next} />
          <OrDivider label="or with email" />
        </>
      )}
      <LoginForm invite={inv ? sp.invite : undefined} next={next} email={inv?.invite.email} />
      <p className="mt-4 text-center text-[12px]">
        <Link href="/forgot" className="text-ink-3 hover:text-ink">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}
