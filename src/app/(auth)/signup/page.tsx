import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { inviteByToken } from "@/server/domain/workspace/members";
import { ROLE_LABEL, type Role } from "@/server/auth/access";
import { Callout } from "@/components/ui";
import { AuthShell, OrDivider } from "@/components/features/auth/auth-shell";
import { DemoButton, SignupForm } from "@/components/features/auth/auth-forms";

export const dynamic = "force-dynamic";

export default async function Signup({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (user && !user.isGuest) redirect(sp.invite ? `/invite/${encodeURIComponent(sp.invite)}` : "/app");
  const inv = sp.invite ? await inviteByToken(await getDb(), sp.invite) : null;
  const qs = sp.invite ? `?invite=${encodeURIComponent(sp.invite)}` : "";

  return (
    <AuthShell
      title={inv ? `Join ${inv.projectName}` : "Create your workspace"}
      description={
        inv
          ? `You've been invited as ${ROLE_LABEL[inv.invite.role as Role] ?? inv.invite.role}. Create an account with ${inv.invite.email} to accept.`
          : "Tell GrowTendril about your product, set a mission and a budget, and it starts scanning the market."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login${qs}`} className="font-medium text-ink hover:text-s1">
            Sign in
          </Link>
        </>
      }
    >
      {sp.invite && !inv && (
        <Callout tone="warn" title="This invite is invalid or has expired" className="mb-5">
          You can still create an account and set up your own workspace.
        </Callout>
      )}
      <SignupForm invite={inv ? sp.invite : undefined} email={inv?.invite.email} />
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-4">GrowTendril never sends unsolicited messages on your behalf. Spend stays within the limits you set.</p>
      {!inv && (
        <>
          <OrDivider label="or try it first" />
          <DemoButton />
        </>
      )}
    </AuthShell>
  );
}
