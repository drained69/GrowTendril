import Link from "next/link";
import { eq } from "drizzle-orm";
import { AlertTriangle, Bot, Building2, FileText, Scale, ShieldCheck, Target } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can, ROLE_LABEL } from "@/server/auth/access";
import { schema as s } from "@/server/db/client";
import { listMembers } from "@/server/domain/workspace/members";
import { ACTIVE_CHAINS, chainLabel } from "@/server/integrations/circle/config";
import { AUTOPILOT_LABEL } from "@/server/jobs/scheduler";
import { microToDecimal } from "@/lib/money";
import { relTime } from "@/lib/time";
import { Badge, Callout, Card, CardHeader, CardBody, CardFooter, EmptyState, LinkButton, ModeBadge, PageHeader } from "@/components/ui";
import { EconomicsForm } from "@/components/features/settings/economics-form";
import { getEconomics } from "@/server/domain/growth/economics";
import { AutopilotControl, DeleteWorkspace, IcpForm, LeaveWorkspace, PolicyForm, ProfileForm, ReprofileButton, WorkspaceForm } from "@/components/features/settings/settings-forms";

const SECTIONS = [
  { id: "workspace", label: "Workspace", icon: <Building2 /> },
  { id: "profile", label: "Product profile", icon: <FileText /> },
  { id: "icp", label: "Ideal customer", icon: <Target /> },
  { id: "policy", label: "Spend policy", icon: <ShieldCheck /> },
  { id: "economics", label: "Economics", icon: <Scale /> },
  { id: "autopilot", label: "Autopilot", icon: <Bot /> },
  { id: "danger", label: "Danger zone", icon: <AlertTriangle /> },
];

export default async function Settings() {
  const { project, role, db, user } = await requireProject();
  const pid = project.id;
  const econ = await getEconomics(db, pid);
  const [[profile], icps, [policy], members, [wallet]] = await Promise.all([
    db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, pid)),
    db.select().from(s.icps).where(eq(s.icps.projectId, pid)),
    db.select().from(s.policies).where(eq(s.policies.projectId, pid)),
    listMembers(db, pid),
    db.select({ provider: s.wallets.provider, address: s.wallets.address }).from(s.wallets).where(eq(s.wallets.projectId, pid)),
  ]);
  const canWorkspace = can(role, "manage_workspace");
  const canPolicy = can(role, "manage_policy");
  const demo = project.dataMode === "DEMO";
  const owners = members.filter((m) => m.role === "owner").length;
  const leaveBlocked = role === "owner" && owners <= 1 ? "You are the only owner — promote another member to owner first." : undefined;
  const isOwner = role === "owner";
  // Mirrors deleteWorkspaceAction, which re-checks (including in-flight payments).
  const deleteBlocked =
    wallet && (wallet.address || wallet.provider !== "unconfigured") ? "This workspace has an agent wallet; deleting it would lose GrowthOS's record of that wallet and any USDC in it. Freeze the wallet instead." : undefined;
  const hasSources = !!(project.website || project.docsUrl || project.githubUrl);
  const reprofileBlocked = demo ? "Demo workspaces are fictional and aren't re-read" : !hasSources ? "Add a website, docs or GitHub URL above first" : undefined;

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
              description="What GrowthOS believes your product is. Edit anything that is wrong — search terms here drive discovery."
              icon={<FileText />}
              action={
                profile && (
                  <>
                    <Badge>{profile.generatedBy}</Badge>
                    {profile.founderEdited && <Badge tone="info">edited</Badge>}
                    {canWorkspace && <ReprofileButton disabled={!!reprofileBlocked} reason={reprofileBlocked} />}
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
                <EmptyState
                  title="No product profile"
                  description="Draft one from the website, docs and GitHub links above."
                  action={canWorkspace ? <ReprofileButton disabled={!!reprofileBlocked} reason={reprofileBlocked} /> : undefined}
                />
              </CardBody>
            )}
          </Card>

          <Card id="icp" className="scroll-mt-4">
            <CardHeader title="Ideal customer profile" description="Segments are matched against public posts to score companies and creators for ICP fit. The other fields are notes for your team." icon={<Target />} />
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
              action={policy && <Badge className="num">v{policy.version}</Badge>}
            />
            {policy ? (
              <>
                <PolicyForm
                  disabled={!canPolicy}
                  chains={ACTIVE_CHAINS.map((id) => ({ id, label: chainLabel(id) }))}
                  p={{
                    maxTransaction: microToDecimal(policy.maxTransactionMicro),
                    dailySpend: microToDecimal(policy.dailySpendMicro),
                    kolThreshold: microToDecimal(policy.kolApprovalThresholdMicro),
                    bountyThreshold: microToDecimal(policy.bountyApprovalThresholdMicro),
                    hardCeiling: microToDecimal(policy.hardCeilingMicro),
                    autonomous: policy.autonomousCategories,
                    approval: policy.approvalCategories,
                    chains: policy.allowedChains,
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

          <Card id="economics" className="scroll-mt-4">
            <CardHeader
              title="Economics"
              description="Your own figures for creator campaign budgets. Every planner number is labelled: measured from your data, your setting here, or a starting value you haven’t reviewed."
              icon={<Scale />}
              action={econ.saved ? <Badge tone="info">Saved</Badge> : <Badge tone="warn">Starting values</Badge>}
            />
            <EconomicsForm
              saved={econ.saved}
              disabled={!canPolicy}
              v={{
                customerValue: econ.values.customerValueMicro != null ? microToDecimal(econ.values.customerValueMicro) : "",
                grossMarginPct: econ.values.grossMarginPct != null ? String(econ.values.grossMarginPct) : "",
                acquisitionSharePct: String(econ.values.acquisitionSharePct),
                conversionRatePct: econ.values.conversionRateBps != null ? String(econ.values.conversionRateBps / 100) : "",
                fixedPaySharePct: String(econ.values.fixedPaySharePct),
                actionBonusSharePct: String(econ.values.actionBonusSharePct),
                minActionsPerCreator: String(econ.values.minActionsPerCreator),
                maxCreators: String(econ.values.maxCreators),
                testPhaseSharePct: String(econ.values.testPhaseSharePct),
                holdbackDays: String(econ.values.holdbackDays),
              }}
            />
          </Card>

          <Card id="autopilot" className="scroll-mt-4">
            <CardHeader
              title="Autopilot"
              description="How often the operator runs a full cycle on its own. Every action still passes the spend policy."
              icon={<Bot />}
              action={<Badge tone={project.autopilot === "off" ? "muted" : "good"} dot={project.autopilot !== "off"}>{AUTOPILOT_LABEL[project.autopilot] ?? project.autopilot}</Badge>}
            />
            {demo && (
              <div className="px-4 pt-4">
                <Callout tone="info">Autopilot runs on live workspaces only. Demo workspaces run cycles on demand.</Callout>
              </div>
            )}
            <AutopilotControl value={project.autopilot} labels={AUTOPILOT_LABEL} disabled={!canPolicy} demo={demo} />
            <CardFooter>
              <span>{project.lastCycleAt ? `Last cycle ${relTime(project.lastCycleAt)}` : "No cycle has run yet"}</span>
              <Link href="/app/runs" className="hover:text-ink">
                View runs →
              </Link>
            </CardFooter>
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
            {isOwner && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-ink">Delete this workspace</div>
                  <p className="mt-0.5 text-[12px] text-ink-3">{deleteBlocked ?? `Permanently deletes ${project.name} and all of its data for every member. Owners only.`}</p>
                </div>
                <DeleteWorkspace workspace={project.name} blocked={deleteBlocked} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
