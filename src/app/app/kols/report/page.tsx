import Link from "next/link";
import { ArrowRight, Download, FileText, Mail, Megaphone, MessageSquare, RefreshCw, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { priced } from "@/server/domain/billing";
import { can } from "@/server/auth/access";
import { latestCreatorReport, type ReportEntry, type Tier } from "@/server/domain/growth/creator-report";
import { refreshCreatorReportAction } from "@/server/actions/creators";
import { emailReportAction } from "@/server/actions/reports";
import { relTime } from "@/lib/time";
import { Avatar, Badge, Callout, Card, CardBody, CardFooter, CardHeader, EmptyState, ExternalLink, LinkButton, PageHeader, ScoreBar, Stat, StatStrip, type Tone } from "@/components/ui";
import { CopyButton } from "@/components/ui/copy";
import { ActionButton } from "@/components/features/agent/action-button";

export const dynamic = "force-dynamic";

const TIER_TONE: Record<Tier, Tone> = { "Contact first": "good", "Worth a test": "info", Watch: "neutral" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function CreatorCard({ e }: { e: ReportEntry }) {
  return (
    <Card id={`creator-${e.rank}`}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="num w-6 pt-1 text-[12px] text-ink-4">#{e.rank}</span>
        <Avatar name={e.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-ink">{e.name}</span>
            {e.profileUrl ? (
              <ExternalLink href={e.profileUrl} className="text-[12px]">
                @{e.handle}
              </ExternalLink>
            ) : (
              <span className="text-[12px] text-ink-3">@{e.handle}</span>
            )}
            <Badge tone="muted">{e.platform}</Badge>
            <Badge tone={TIER_TONE[e.tier]}>{e.tier}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
            <span>
              <span className="num text-ink-2">{e.followers != null ? e.followers.toLocaleString() : "—"}</span> followers
            </span>
            <span>
              Score <span className="num text-ink-2">{e.overall}</span>/100
            </span>
            <span>
              Est. <span className="num text-ink-2">{(e.estimatedCostMicro / 1e6).toFixed(0)}</span> USDC per piece
            </span>
            {e.lastActive && <span>Last post {relTime(e.lastActive)}</span>}
          </div>
          {e.bio && <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-3">{e.bio}</p>}
        </div>
      </div>

      <CardBody className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink-2">{e.analysis}</p>
          <Section title="Why contact them">
            <ul className="space-y-1 text-[12.5px] text-ink-2">
              {e.whyContact.map((w, iw) => (
                <li key={`${iw}:${w}`} className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-good" />
                  {w}
                </li>
              ))}
            </ul>
          </Section>
          {e.topics.length > 0 && (
            <Section title="What they post about">
              <div className="flex flex-wrap gap-1">
                {e.topics.map((t, it) => (
                  <Badge key={`${it}:${t}`} tone="muted">
                    {t}
                  </Badge>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-ink-3">
                {e.relevantPosts} of {e.postsRead} recent posts on-topic · ~{e.avgEngagement.toLocaleString()} weighted interactions per on-topic post
              </p>
            </Section>
          )}
          {e.recentPosts.length > 0 && (
            <Section title="Their best recent posts">
              <ul className="space-y-2">
                {e.recentPosts.map((p) => (
                  <li key={p.url} className="rounded-[8px] border border-line bg-bg/40 px-3 py-2">
                    <p className="text-[12px] text-ink-2">{p.excerpt}</p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-4">
                      <span>{relTime(p.publishedAt)}</span>
                      <span className="num">{p.engagement.toLocaleString()} interactions</span>
                      <ExternalLink href={p.url} className="ml-auto text-[11px]">
                        Open
                      </ExternalLink>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Suggested approach">
            <p className="text-[12.5px] text-ink-2">{e.approach}</p>
          </Section>
          <Section title="Risks">
            <ul className="space-y-1 text-[12.5px] text-ink-3">
              {e.risks.map((r, ir) => (
                <li key={`${ir}:${r}`} className="flex gap-2">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {r}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="How to reach them">
            <ul className="divide-y divide-line rounded-[8px] border border-line">
              {e.contacts.map((c) => (
                <li key={`${c.kind}-${c.href}`} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-ink-3 [&_svg]:size-3.5">{c.kind === "email" ? <Mail /> : c.kind === "profile" ? <UserRound /> : <MessageSquare />}</span>
                  <span className="min-w-0 flex-1">
                    <a href={c.href} target={c.kind === "email" ? undefined : "_blank"} rel="noreferrer" className="block truncate text-[12.5px] font-medium text-ink hover:underline">
                      {c.label}: <span className="font-normal text-ink-2">{c.value}</span>
                    </a>
                    <span className="block text-[11px] text-ink-4">{c.note}</span>
                  </span>
                  {c.kind === "email" && <CopyButton value={c.value} />}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Score breakdown">
            <div className="space-y-1.5">
              {e.scores.map((sc) => (
                <div key={sc.key} title={sc.reason}>
                  <ScoreBar value={sc.score} label={sc.label} />
                </div>
              ))}
            </div>
          </Section>
          <Section title="Draft message — you send it">
            <div className="relative">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[8px] border border-line bg-bg/40 p-3 font-sans text-[12px] leading-relaxed text-ink-2">{e.outreachDraft}</pre>
              <div className="absolute right-2 top-2">
                <CopyButton value={e.outreachDraft} label="Copy" />
              </div>
            </div>
          </Section>
        </div>
      </CardBody>

      <CardFooter>
        <span>{e.mentionsUs ? "Already mentioned you" : e.competitorsCovered.length ? `Covers ${e.competitorsCovered.join(", ")}` : "New audience for you"}</span>
        <span className="flex gap-3">
          <Link href={`/app/kols/${e.kolId}`} className="hover:text-ink">
            Full profile
          </Link>
          <Link href={`/app/kols/${e.kolId}/brief`} className="hover:text-ink">
            Campaign brief
          </Link>
          {e.opportunityId && (
            <Link href={`/app/opportunities/${e.opportunityId}`} className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
              Plan a campaign <ArrowRight className="size-3" />
            </Link>
          )}
        </span>
      </CardFooter>
    </Card>
  );
}

export default async function InfluencerReport() {
  const { project, role, db } = await requireProject();
  const report = await latestCreatorReport(db, project.id);
  const operate = can(role, "operate");
  const refresh = operate ? <ActionButton action={refreshCreatorReportAction} label={priced(report ? "Refresh report" : "Build report", "creator_report")} icon={<RefreshCw />} variant={report ? "secondary" : "primary"} logTitle="Influencer report" /> : null;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[
          { label: "Creators", href: "/app/kols" },
          { label: "Influencer report", href: "/app/kols/report" },
        ]}
        title="Influencer report"
        description={`The creators most worth contacting for ${project.name}: why they fit, what they post about, how to reach them, and a first message you can send yourself.`}
        meta={report ? <span>Updated {relTime(report.generatedAt)} · {report.generatedBy === "claude" ? "analysis written by AI" : "analysis from templates"}</span> : undefined}
        actions={
          <>
            {report && (
              <>
                <LinkButton href="/app/kols/report/export?format=md" icon={<Download />}>
                  Markdown
                </LinkButton>
                <LinkButton href="/app/kols/report/export?format=csv" icon={<FileText />}>
                  CSV
                </LinkButton>
                <ActionButton action={emailReportAction.bind(null, "creators")} label="Email me" icon={<Mail />} />
              </>
            )}
            {refresh}
          </>
        }
      />

      {!report ? (
        <Card>
          <EmptyState
            icon={<Megaphone />}
            title="No report yet"
            description="GrowTendril builds this after each market scan. Build it now to scout creators who cover your space, read their recent posts and public profiles, and rank them."
            action={refresh ?? undefined}
          />
        </Card>
      ) : (
        <>
          <StatStrip className="grid-cols-2 sm:grid-cols-4">
            <Stat label="Creators analysed" value={report.totals.creators} />
            <Stat label="Contact first" value={report.totals.contactFirst} tone={report.totals.contactFirst ? "good" : undefined} />
            <Stat label="Public email or website" value={report.totals.withPublicContact} sub="from their own profiles" />
            <Stat label="Platforms" value={Object.keys(report.totals.platforms).length} sub={Object.entries(report.totals.platforms).map(([p, n]) => `${p} ${n}`).join(" · ")} />
          </StatStrip>

          <Card>
            <CardHeader title="Your creator landscape" icon={<Sparkles />} />
            <CardBody className="space-y-3 text-[12.5px] text-ink-2">
              <p>
                Searching for <span className="text-ink">{report.keywords.join(", ")}</span>. {report.topTopics.length ? <>These creators talk most about <span className="text-ink">{report.topTopics.slice(0, 5).join(", ")}</span>.</> : null}
              </p>
              <ul className="space-y-1 text-[12px] text-ink-3">
                {report.method.map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Callout tone="info" title="You make the contact">
            GrowTendril never messages anyone. Contact details are only what each creator publishes on their own profile. Paid collaborations must be disclosed as sponsored.
          </Callout>

          {report.entries.map((e) => (
            <CreatorCard key={e.kolId} e={e} />
          ))}
        </>
      )}
    </div>
  );
}
