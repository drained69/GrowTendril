import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { AlertTriangle, Bot, Building2, FileText, Mail, ShieldCheck, Target, UserRound } from "lucide-react";
import { balanceMicro, billingMode } from "@/server/domain/billing";
import { fmtUsdc } from "@/lib/money";
import { googleConfigured } from "@/server/auth/google";
import { signOutEverywhereAction } from "@/server/actions/auth";
import { requireProject } from "@/server/auth/current";
import { can, ROLE_LABEL } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { listMembers } from "@/server/domain/workspace/members";
import { AUTOPILOT_LABEL } from "@/server/jobs/scheduler";
import { microToDecimal } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardHeader, CardBody, CardFooter, EmptyState, LinkButton, ModeBadge, PageHeader } from "@/components/ui";
import { AutopilotControl, IcpForm, LeaveWorkspace, PolicyForm, ProfileForm, WorkspaceForm } from "@/components/features/settings/settings-forms";

const SECTIONS = [
  { id: "workspace", label: "Workspace", icon: <Building2 /> },
  { id: "profile", label: "Product profile", icon: <FileText /> },
  { id: "icp", label: "Ideal customer", icon: <Target /> },
  { id: "policy", label: "Spend policy", icon: <ShieldCheck /> },
  { id: "autopilot", label: "Autopilot", icon: <Bot /> },
  { id: "account", label: "Account & billing", icon: <UserRound /> },
  { id: "danger", label: "Danger zone", icon: <AlertTriangle /> },
];

const EMAIL_KIND: Record<string, string> = {
  verify_code: "Verification code",
  reset_code: "Password reset code",
  welcome: "Welcome",
  subscription_active: "Payment received",
  renewal_reminder: "Renewal reminder",
  payment_failed: "Payment failed",
  subscription_canceled: "Plan ended",
  credit_added: "Credit added",
  invite: "Workspace invite",
  report: "Report",
};

export default async function Settings() {
  const { project, role, db, user } = await requireProject();
  const pid = project.id;
  const [[profile], icps, [policy], members, credit, emails] = await Promise.all([
    db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, pid)),
    db.select().from(s.icps).where(eq(s.icps.projectId, pid)),
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    listMembers(db, pid),
    balanceMicro(db, project.ownerId),
    db.select().from(s.emailLog).where(eq(s.emailLog.userId, user.id)).orderBy(desc(s.emailLog.createdAt)).limit(6),
  ]);
  const mode = billingMode();
  const canWorkspace = can(role, "manage_workspace");
  const canPolicy = can(role, "manage_policy");
  const owners = members.filter((m) => m.role === "owner").length;
  const leaveBlocked = role === "owner" && owners <= 1 ? "You are the only owner — promote another member to owner first." : undefined;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Workspace details, the product profile that drives discovery, your ideal customer, and the founder's hard spending rules."
        meta={
          <>
            <ModeBadge mode={project.dataMode} />
            <span>
              Your role: <span className="text-ink-2">{ROLE_LABEL[role]}</span>
            </span>
          </>
        }
        actions={
          <>
            <LinkButton href="/app/team">Team</LinkButton>
            <LinkButton href="/app/integrations">Integrations</LinkButton>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <a href={`#${x.id}`} className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5">
                  {x.icon}
                  {x.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          {!canWorkspace && !canPolicy && <Callout tone="info" title="Read-only">Your role can view settings but not change them. Ask an owner or admin for changes.</Callout>}

          <Card id="workspace" className="scroll-mt-4">
            <CardHeader title="Workspace" description="Name and public links for this product." icon={<Building2 />} />
            <WorkspaceForm w={{ name: project.name, website: project.website, docsUrl: project.docsUrl, githubUrl: project.githubUrl, xHandle: project.xHandle }} disabled={!canWorkspace} />
          </Card>

          <Card id="profile" className="scroll-mt-4">
            <CardHeader
              title="Product intelligence profile"
              description="What GrowTendril believes your product is. Edit anything that is wrong — search terms here drive discovery."
              icon={<FileText />}
              action={
                profile && (
                  <>
                    <Badge>{profile.generatedBy}</Badge>
                    {profile.founderEdited && <Badge tone="info">edited</Badge>}
                  </>
                )
              }
            />
            {profile ? (
              <>
                <ProfileForm p={profile} disabled={!canWorkspace} />
                <CardFooter className="block">
                  <span className="label mr-2">Sources read</span>
                  {profile.crawledSources.length ? (
                    profile.crawledSources.map((c) => (
                      <span key={c.url} className="mr-3 inline-flex items-center gap-1">
                        <span className={c.ok ? "text-good" : "text-critical"}>{c.ok ? "✓" : "✕"}</span>
                        <span className="num text-ink-2">{c.url}</span>
                        {!c.ok && c.note && <span className="text-ink-4">({c.note})</span>}
                      </span>
                    ))
                  ) : (
                    <span>None — the profile was drafted from your description only.</span>
                  )}
                </CardFooter>
              </>
            ) : (
              <CardBody>
                <EmptyState title="No product profile" description="The profile is created during onboarding from your product's public pages." action={<LinkButton href="/onboarding">Open onboarding</LinkButton>} />
              </CardBody>
            )}
          </Card>

          <Card id="icp" className="scroll-mt-4">
            <CardHeader title="Ideal customer profile" description="Who the operator qualifies companies against." icon={<Target />} />
            {icps.length ? (
              <IcpForm icps={icps} disabled={!canWorkspace} />
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">No ICP yet. It is proposed from the product profile during onboarding step 2.</CardBody>
            )}
          </Card>

          <Card id="policy" className="scroll-mt-4">
            <CardHeader
              title="Spend policy"
              description="Enforced in code by a deterministic policy engine on every structured action — not in a prompt."
              icon={<ShieldCheck />}
              action={
                policy && (
                  <span className="flex items-center gap-1.5">
                    <Badge tone={policy.autonomyEnabled ? "good" : "muted"}>{policy.autonomyEnabled ? `Autonomous ≤ ${microToDecimal(policy.maxTransactionMicro)} USDC` : "Asks first"}</Badge>
                    <Badge className="num">v{policy.version}</Badge>
                  </span>
                )
              }
            />
            {policy ? (
              <>
                <PolicyForm
                  disabled={!canPolicy}
                  p={{
                    autonomousLimit: policy.autonomyEnabled ? microToDecimal(policy.maxTransactionMicro) : "0",
                    dailySpend: microToDecimal(policy.dailySpendMicro),
                    hardCeiling: microToDecimal(policy.hardCeilingMicro),
                    forbidden: policy.forbiddenActions,
                    tokens: policy.allowedTokens,
                  }}
                />
                <CardFooter>Last changed {relTime(policy.updatedAt)}</CardFooter>
              </>
            ) : (
              <CardBody className="text-[12.5px] text-ink-3">No policy yet — it is created in the final onboarding step.</CardBody>
            )}
          </Card>

          <Card id="autopilot" className="scroll-mt-4">
            <CardHeader
              title="Autopilot"
              description="How often the operator runs a full cycle on its own. Every action still passes the spend policy."
              icon={<Bot />}
              action={<Badge tone={project.autopilot === "off" ? "muted" : "good"} dot={project.autopilot !== "off"}>{AUTOPILOT_LABEL[project.autopilot] ?? project.autopilot}</Badge>}
            />
            <AutopilotControl value={project.autopilot} labels={AUTOPILOT_LABEL} disabled={!canPolicy} billing={mode !== "off"} />
            <CardFooter>
              <span>{project.lastCycleAt ? `Last cycle ${relTime(project.lastCycleAt)}` : "No cycle has run yet"}</span>
              <Link href="/app/runs" className="hover:text-ink">
                View runs →
              </Link>
            </CardFooter>
          </Card>

          <Card id="account" className="scroll-mt-4">
            <CardHeader title="Account & billing" description="Your sign-in, your credit, and what GrowTendril has emailed you." icon={<UserRound />} />
            <ul className="divide-y divide-line text-[12.5px]">
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{user.email}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    Sign-in: {[user.hasPassword && "password", user.googleLinked && "Google"].filter(Boolean).join(" and ") || "—"}
                  </div>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={user.emailVerified ? "good" : "warn"}>{user.emailVerified ? "Email verified" : "Not verified"}</Badge>
                  {googleConfigured() && !user.googleLinked && (
                    <a href="/api/auth/google?next=/app/settings%23account" className="text-[12px] text-ink-2 underline-offset-2 hover:underline">
                      Link Google
                    </a>
                  )}
                  <Link href={`/forgot?email=${encodeURIComponent(user.email)}`} className="text-[12px] text-ink-2 underline-offset-2 hover:underline">
                    {user.hasPassword ? "Change password" : "Add a password"}
                  </Link>
                </span>
              </li>
              {mode !== "off" && (
                <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium text-ink">
                      Credit balance <span className="num ml-1">{fmtUsdc(credit)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">{project.ownerId === user.id ? "Services in workspaces you own are paid from this balance." : "Services in this workspace are paid from its owner's balance."}</div>
                  </div>
                  <span className="flex items-center gap-2">
                    <LinkButton href="/billing" size="sm">
                      Billing
                    </LinkButton>
                  </span>
                </li>
              )}
              <li className="px-4 py-3">
                <div className="mb-1.5 flex items-center gap-1.5 font-medium text-ink">
                  <Mail className="size-3.5 text-ink-3" /> Emails sent to you
                </div>
                {emails.length ? (
                  <ul className="space-y-1 text-[12px] text-ink-3">
                    {emails.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">
                          <span className="text-ink-2">{EMAIL_KIND[e.kind] ?? e.kind}</span> — {e.subject.replace(/^\d{6} is your /, "Your ")}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone={e.status === "sent" ? "good" : e.status === "logged" ? "muted" : "bad"}>{e.status === "logged" ? "dev console" : e.status}</Badge>
                          <span className="num">{relTime(e.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-ink-3">Nothing yet.</p>
                )}
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium text-ink">Sign out everywhere</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">Ends every session on every device, including this one.</div>
                </div>
                <form action={signOutEverywhereAction}>
                  <button type="submit" className="rounded-[6px] border border-line-strong px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-surface-2">
                    Sign out everywhere
                  </button>
                </form>
              </li>
            </ul>
          </Card>

          <Card id="danger" className="scroll-mt-4 border-critical/30">
            <CardHeader title="Danger zone" icon={<AlertTriangle className="text-critical" />} />
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-ink">Leave this workspace</div>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {leaveBlocked ?? `Removes ${user.email} from ${project.name}. Data stays with the workspace.`}
                </p>
              </div>
              <LeaveWorkspace workspace={project.name} blocked={leaveBlocked} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
