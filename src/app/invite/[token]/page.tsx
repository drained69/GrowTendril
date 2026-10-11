import Link from "next/link";
import { Clock, LogIn, UserPlus } from "lucide-react";
import { currentUser } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { inviteByToken } from "@/server/domain/workspace/members";
import { ROLE_HELP, ROLE_LABEL, type Role } from "@/server/auth/access";
import { logoutAction } from "@/server/actions/auth";
import { relTime } from "@/lib/time";
import { Avatar, Badge, Button, Callout, KeyValue, LinkButton } from "@/components/ui";
import { AuthShell } from "@/components/features/auth/auth-shell";
import { AcceptInvite } from "@/components/features/team/accept-invite";

export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, inv] = await Promise.all([currentUser(), getDb().then((db) => inviteByToken(db, token))]);

  if (!inv)
    return (
      <AuthShell
        title="This invite can't be used"
        description="The link is invalid, was already accepted, was revoked, or has expired (invites last 7 days)."
        footer={
          <Link href="/" className="hover:text-ink">
            Back to GrowTendril
          </Link>
        }
      >
        <Callout tone="warn" title="Ask for a new link">
          A workspace owner or admin can create a fresh invite from Team in their workspace.
        </Callout>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <LinkButton href={user && !user.isGuest ? "/app" : "/login"} size="lg">
            {user && !user.isGuest ? "Go to app" : "Sign in"}
          </LinkButton>
          <LinkButton href="/signup" size="lg" variant="ghost">
            Create account
          </LinkButton>
        </div>
      </AuthShell>
    );

  const role = inv.invite.role as Role;
  const t = encodeURIComponent(token);
  const signedIn = user && !user.isGuest;
  const mismatch = signedIn && user.email.toLowerCase() !== inv.invite.email;

  return (
    <AuthShell title={`Join ${inv.projectName}`} description="You've been invited to collaborate in a GrowTendril workspace.">
      <div className="rounded-[10px] border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <Avatar name={inv.projectName} size={36} square />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">{inv.projectName}</div>
            <div className="text-[12px] text-ink-3">GrowTendril workspace</div>
          </div>
        </div>
        <KeyValue
          className="mt-4"
          items={[
            { k: "Invited address", v: <span className="num">{inv.invite.email}</span> },
            { k: "Role", v: <Badge tone="info">{ROLE_LABEL[role] ?? role}</Badge> },
            {
              k: "Expires",
              v: (
                <span className="inline-flex items-center gap-1 text-ink-2">
                  <Clock className="size-3" />
                  {relTime(inv.invite.expiresAt)}
                </span>
              ),
            },
          ]}
        />
        {ROLE_HELP[role] && <p className="mt-3 border-t border-line pt-3 text-[12px] leading-snug text-ink-3">{ROLE_HELP[role]}</p>}
      </div>

      <div className="mt-5 space-y-3">
        {!signedIn ? (
          <>
            <LinkButton href={`/signup?invite=${t}`} variant="primary" size="lg" className="w-full" icon={<UserPlus />}>
              Create account &amp; join
            </LinkButton>
            <LinkButton href={`/login?invite=${t}`} size="lg" className="w-full" icon={<LogIn />}>
              I already have an account
            </LinkButton>
            <p className="text-center text-[11.5px] text-ink-3">Use {inv.invite.email} — invites are bound to that address.</p>
          </>
        ) : mismatch ? (
          <>
            <Callout tone="danger" title="Signed in with a different email">
              You&apos;re signed in as <span className="num">{user.email}</span>, but this invite is for <span className="num">{inv.invite.email}</span>. Sign out and sign in with the invited address.
            </Callout>
            <form action={logoutAction}>
              <input type="hidden" name="next" value={`/invite/${token}`} />
              <Button type="submit" size="lg" className="w-full">
                Sign out and use {inv.invite.email}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <Avatar name={user.name || user.email} size={20} />
              Signed in as <span className="text-ink-2">{user.email}</span>
            </div>
            <AcceptInvite token={token} workspace={inv.projectName} />
          </>
        )}
      </div>
    </AuthShell>
  );
}
