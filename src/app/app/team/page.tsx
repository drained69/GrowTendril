import { Clock, Mail, ShieldCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can, ROLES, ROLE_HELP, ROLE_LABEL, type Role } from "@/server/auth/access";
import { listInvites, listMembers } from "@/server/domain/workspace/members";
import { removeMemberAction, revokeInviteAction } from "@/server/actions/team";
import { relTime } from "@/lib/time";
import { Avatar, Badge, Callout, Card, CardBody, CardFooter, CardHeader, PageHeader, type Tone } from "@/components/ui";
import { ActionButton } from "@/components/features/agent/action-button";
import { InviteForm, RoleSelect } from "@/components/features/team/team-controls";

const ROLE_TONE: Record<string, Tone> = { owner: "accent", admin: "info", member: "neutral", viewer: "muted" };

export default async function Team() {
  const { project, role, user, db } = await requireProject();
  const [members, invites] = await Promise.all([listMembers(db, project.id), can(role, "manage_members") ? listInvites(db, project.id) : Promise.resolve([])]);
  const canManage = can(role, "manage_members");
  const isOwner = role === "owner";
  // Only owners may grant or change the owner role.
  const options = ROLES.filter((r) => isOwner || r !== "owner").map((r) => ({ value: r, label: ROLE_LABEL[r], help: ROLE_HELP[r] }));
  const allOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], help: ROLE_HELP[r] }));
  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        description={`Who can see and operate ${project.name}. Roles are enforced server-side on every action.`}
        meta={
          <>
            <span>
              <span className="num text-ink-2">{members.length}</span> member{members.length === 1 ? "" : "s"}
            </span>
            {canManage && (
              <span>
                · <span className="num text-ink-2">{invites.length}</span> pending invite{invites.length === 1 ? "" : "s"}
              </span>
            )}
          </>
        }
      />

      {!canManage && <Callout tone="info" title="Read-only">Only owners and admins can invite people or change roles.</Callout>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {canManage && (
            <Card>
              <CardHeader title="Invite a teammate" description="Creates a single-use link for their email address. Email isn't verified — anyone holding the link can join as that address, so share it privately." icon={<UserPlus />} />
              <CardBody>
                <InviteForm options={options} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Members" icon={<Users />} />
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const self = m.userId === user.id;
                const ownerLocked = m.role === "owner" && !isOwner;
                const lastOwner = m.role === "owner" && owners <= 1;
                return (
                  <li key={m.userId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                    <Avatar name={m.name || m.email} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[12.5px]">
                        <span className="truncate font-medium text-ink">{m.name || m.email.split("@")[0]}</span>
                        {self && <Badge tone="muted">You</Badge>}
                      </div>
                      <div className="truncate text-[11.5px] text-ink-3">
                        {m.email} · joined {relTime(m.joinedAt)}
                        {m.lastLoginAt && <> · active {relTime(m.lastLoginAt)}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage && !self && !ownerLocked ? (
                        <>
                          <RoleSelect userId={m.userId} role={m.role} name={m.name || m.email} options={m.role === "owner" ? allOptions : options} disabled={lastOwner} />
                          <ActionButton
                            action={removeMemberAction.bind(null, m.userId)}
                            label={<span className="sr-only">Remove member</span>}
                            icon={<UserMinus />}
                            variant="ghost"
                            size="xs"
                            disabled={lastOwner}
                            confirm={`Remove ${m.email} from ${project.name}? They lose access immediately.`}
                            className="text-ink-3 hover:text-critical"
                          />
                        </>
                      ) : (
                        <Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{ROLE_LABEL[m.role as Role] ?? m.role}</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {owners <= 1 && <CardFooter>A workspace always keeps at least one owner. Leave from Settings → Danger zone.</CardFooter>}
          </Card>

          {canManage && (
            <Card>
              <CardHeader title="Pending invites" description="Unaccepted links that haven't expired." icon={<Mail />} />
              {invites.length ? (
                <ul className="divide-y divide-line">
                  {invites.map((i) => (
                    <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] text-ink">{i.email}</div>
                        <div className="flex items-center gap-1 text-[11.5px] text-ink-3">
                          <Clock className="size-3" />
                          sent {relTime(i.createdAt)} · expires {relTime(i.expiresAt)}
                        </div>
                      </div>
                      <Badge tone={ROLE_TONE[i.role] ?? "neutral"}>{ROLE_LABEL[i.role as Role] ?? i.role}</Badge>
                      <ActionButton action={revokeInviteAction.bind(null, i.id)} label="Revoke" icon={<X />} variant="ghost" size="xs" confirm={`Revoke the invite for ${i.email}? The link stops working.`} />
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-[12.5px] text-ink-3">No pending invites. Create one above — the link is shown once for you to share.</CardBody>
              )}
            </Card>
          )}
        </div>

        <Card className="self-start">
          <CardHeader title="Roles" description="What each role can do in this workspace." icon={<ShieldCheck />} />
          <ul className="divide-y divide-line">
            {ROLES.map((r) => (
              <li key={r} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Badge>
                  {r === role && <span className="text-[11px] text-ink-4">your role</span>}
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{ROLE_HELP[r]}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
