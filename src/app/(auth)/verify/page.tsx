import { safeNext } from "@/server/auth/next-step";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/server/auth/current";
import { logoutAction } from "@/server/actions/auth";
import { emailDevFallback } from "@/server/integrations/email";
import { Callout } from "@/components/ui";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { VerifyForm } from "@/components/features/auth/auth-forms";

export const dynamic = "force-dynamic";

export default async function Verify({ searchParams }: { searchParams: Promise<{ invite?: string; next?: string }> }) {
  const sp = await searchParams;
  const user = await requireSignedIn();
  if (user.emailVerified) redirect(sp.invite ? `/invite/${encodeURIComponent(sp.invite)}` : safeNext(sp.next));
  const invite = sp.invite && /^[A-Za-z0-9_-]{10,80}$/.test(sp.invite) ? sp.invite : undefined;
  return (
    <AuthShell
      title="Check your email"
      description={
        <>
          We sent a 6-digit code to <span className="text-ink">{user.email}</span>. Enter it to confirm your account.
        </>
      }
      footer={
        <form action={logoutAction}>
          Wrong address?{" "}
          <button type="submit" className="font-medium text-ink hover:text-s1">
            Sign out and start again
          </button>
        </form>
      }
    >
      {emailDevFallback() && (
        <Callout tone="info" title="Development" className="mb-5">
          Email delivery isn&apos;t configured, so the code is printed in the server console.
        </Callout>
      )}
      <VerifyForm next={safeNext(sp.next)} email={user.email} invite={invite} />
    </AuthShell>
  );
}
