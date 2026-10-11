import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { inviteByToken } from "@/server/domain/workspace/members";
import { ROLE_LABEL, type Role } from "@/server/auth/access";
import { safeNext } from "@/server/auth/safe-next";
import { Callout } from "@/components/ui";
import { AuthShell, OrDivider } from "@/components/features/auth/auth-shell";
import { DemoButton, LoginForm } from "@/components/features/auth/auth-forms";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next ? safeNext(sp.next, "") || undefined : undefined;
  const user = await currentUser();
  if (user && !user.isGuest) redirect(sp.invite ? `/invite/${encodeURIComponent(sp.invite)}` : (next ?? "/app"));
  const inv = sp.invite ? await inviteByToken(await getDb(), sp.invite) : null;
  const qs = sp.invite ? `?invite=${encodeURIComponent(sp.invite)}` : "";

  return (
    <AuthShell
      title={inv ? `Join ${inv.projectName}` : "Sign in to GrowthOS"}
      description={inv ? `Sign in as ${inv.invite.email} to accept your invite as ${ROLE_LABEL[inv.invite.role as Role] ?? inv.invite.role}.` : "Welcome back. Pick up where your operator left off."}
      footer={
        <>
          New to GrowthOS?{" "}
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
      <LoginForm invite={inv ? sp.invite : undefined} next={next} email={inv?.invite.email} />
      {!inv && (
        <>
          <OrDivider />
          <DemoButton />
          <p className="mt-2.5 text-center text-[11.5px] leading-relaxed text-ink-3">No keys needed. Seeded data is labelled DEMO; payments without a wallet are labelled SIMULATED.</p>
        </>
      )}
    </AuthShell>
  );
}
