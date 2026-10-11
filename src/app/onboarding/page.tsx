import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Check, FileText, Flag, Globe, Package, ShieldCheck, Target } from "lucide-react";
import { requireUser, currentProject } from "@/server/auth/current";
import { getDb, schema as s } from "@/server/db/client";
import { AUTOPILOT_LABEL } from "@/server/jobs/scheduler";
import { billingMode } from "@/server/domain/billing";
import { logoutAction } from "@/server/actions/auth";
import { Badge, Callout, Card, CardHeader, CardFooter, LinkButton, cn } from "@/components/ui";
import { Logo } from "@/components/layout/logo";
import { ProfileForm, IcpForm } from "@/components/features/settings/settings-forms";
import { ProductStep, GenerateIcp, MissionStep, AutonomyStep, QuickStartStep } from "@/components/features/onboarding/onboarding-forms";

export const dynamic = "force-dynamic";

const STEPS = [
  { label: "Product", sub: "What you sell" },
  { label: "Customer", sub: "Profile & ICP" },
  { label: "Mission", sub: "Goal & budget" },
  { label: "Autonomy", sub: "Hard spending rules" },
];

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ new?: string; step?: string; manual?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await getDb();
  const cur = sp.new ? null : await currentProject(user.id);
  const project = cur?.project ?? null;
  // An existing finished workspace + an explicit request for a new mission jumps to step 3.
  const step = !project ? 1 : sp.step === "3" ? 3 : Math.min(project.onboardingStep, 4);
  const [profile] = project ? await db.select().from(s.productProfiles).where(eq(s.productProfiles.projectId, project.id)) : [];
  const icps = project ? await db.select().from(s.icps).where(eq(s.icps.projectId, project.id)) : [];
  const finished = !!project && project.onboardingStep >= 5;
  const canEdit = !cur || cur.role === "owner";
  const canPolicy = !cur || cur.role === "owner" || cur.role === "admin";

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            {finished ? (
              <LinkButton href="/app" size="sm" variant="ghost">
                Back to app
              </LinkButton>
            ) : (
              <>
                <span className="hidden sm:inline">{user.email}</span>
                <form action={logoutAction}>
                  <button type="submit" className="hover:text-ink">
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="display display-bounce text-[30px] leading-tight text-ink">{project ? `Set up ${project.name}` : "Set up your workspace"}</h1>
          <p className="mt-1 text-[13px] text-ink-3">{step === 1 && !sp.manual ? "One link is enough. Everything can be changed later in Settings." : "Four short steps. Everything here can be changed later in Settings."}</p>
        </div>

        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Onboarding progress">
          {STEPS.map((x, i) => {
            const n = i + 1;
            const done = n < step;
            const active = n === step;
            return (
              <li key={x.label} aria-current={active ? "step" : undefined} className="min-w-0">
                <div className={cn("h-1 rounded-full", done ? "bg-good" : active ? "bg-accent" : "bg-line")} />
                <div className="mt-2.5 flex items-center gap-2">
                  <span className={cn("num grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-medium ring-1 [&_svg]:size-3", done ? "bg-good/15 text-good ring-good/30" : active ? "bg-accent text-white ring-accent" : "bg-surface-2 text-ink-4 ring-line-strong")}>
                    {done ? <Check /> : n}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[12.5px] font-medium", active ? "text-ink" : done ? "text-ink-2" : "text-ink-4")}>{x.label}</span>
                    <span className="hidden truncate text-[11px] text-ink-4 sm:block">{x.sub}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        {user.isGuest && step === 1 && (
          <Callout tone="warn" title="Create an account" className="mb-4" action={<LinkButton href="/signup" size="xs" variant="primary">Create account</LinkButton>}>
            An account is required to set up a workspace.
          </Callout>
        )}

        {step === 1 && !sp.manual && (
          <Card>
            <CardHeader title="Start with your website" description="Paste one link. GrowTendril reads your site, works out what you sell and who buys it, sets a first goal with safe limits, and starts finding customers and creators." icon={<Globe />} />
            <QuickStartStep />
            <CardFooter>
              <span>No website yet, or want to fill it in yourself?</span>
              <Link href={`/onboarding?manual=1${sp.new ? "&new=1" : ""}`} className="font-medium text-ink-2 hover:text-ink">
                Set up step by step →
              </Link>
            </CardFooter>
          </Card>
        )}

        {step === 1 && sp.manual && (
          <Card>
            <CardHeader title="Your product" description="Tell GrowTendril what you sell and who buys it. It drafts a product profile from your public pages." icon={<Package />} />
            <ProductStep />
            <CardFooter>
              <span>Have a website?</span>
              <Link href={`/onboarding${sp.new ? "?new=1" : ""}`} className="font-medium text-ink-2 hover:text-ink">
                Set up from a link instead →
              </Link>
            </CardFooter>
          </Card>
        )}

        {step === 2 && profile && (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Product intelligence profile"
                description="Correct anything that's wrong — this drives what GrowTendril searches for."
                icon={<FileText />}
                action={<Badge>{profile.generatedBy}</Badge>}
              />
              <div className="border-b border-line px-4 py-2.5 text-[11.5px] text-ink-3">
                <span className="label mr-2">Read from</span>
                {profile.crawledSources.length
                  ? profile.crawledSources.map((c) => (
                      <span key={c.url} className="mr-3 inline-flex items-center gap-1">
                        <span className={c.ok ? "text-good" : "text-critical"}>{c.ok ? "✓" : "✕"}</span>
                        <span className="num text-ink-2">{c.url}</span>
                        {!c.ok && c.note && <span className="text-ink-4">({c.note})</span>}
                      </span>
                    ))
                  : "your description only"}
              </div>
              <ProfileForm p={profile} disabled={!canEdit} />
            </Card>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div>
                  <div className="text-[13px] font-medium text-ink">Next: your ideal customer</div>
                  <p className="text-[12px] text-ink-3">Save any edits first, then let GrowTendril propose ICP tiers from the profile.</p>
                </div>
                {canEdit ? <GenerateIcp /> : <span className="text-[12px] text-ink-3">Only the owner can propose the customer profile.</span>}
              </div>
            </Card>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {icps.length > 0 && (
              <Card>
                <CardHeader title="Proposed ideal customer profile" description="Edit freely — the operator qualifies companies against these." icon={<Target />} />
                <IcpForm icps={icps} disabled={!canEdit} />
              </Card>
            )}
            <Card>
              <CardHeader title="Growth mission" description="A measurable goal and a USDC budget ceiling. Nothing is spent without one." icon={<Flag />} />
              {canPolicy ? <MissionStep audience={profile?.audience} category={profile?.category} /> : <CardFooter>Only owners and admins can set missions.</CardFooter>}
            </Card>
          </div>
        )}

        {step === 4 && (
          <Card>
            <CardHeader title="Autonomy: the hard rules" description="Enforced by a deterministic policy engine on every structured action — not by a prompt." icon={<ShieldCheck />} />
            {canPolicy ? <AutonomyStep autopilot={AUTOPILOT_LABEL} billing={billingMode() !== "off"} /> : <CardFooter>Only owners and admins can activate the workspace.</CardFooter>}
          </Card>
        )}
      </div>
    </div>
  );
}
