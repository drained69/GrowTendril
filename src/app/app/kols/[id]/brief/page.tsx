import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowUpRight, FileText, PenLine, RefreshCw } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { priced } from "@/server/domain/billing";
import { generateBriefAction } from "@/server/actions/agent";
import { ActionButton } from "@/components/features/agent/action-button";
import { schema as s } from "@/server/db/client";
import { kolBriefCached, type KolBrief } from "@/server/domain/growth/kol-brief";
import { Badge, Callout, Card, CardBody, CardHeader, ModeBadge, PageHeader } from "@/components/ui";
import { CopyButton, CopyField } from "@/components/ui/copy";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:grid-cols-[160px_1fr] sm:gap-4">
      <div className="label pt-0.5">{title}</div>
      <div className="min-w-0 text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((x, ix) => (
        <li key={`${ix}:${x}`} className="flex gap-2">
          <span className="mt-[8px] size-1 shrink-0 rounded-full bg-ink-4" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Brief({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ experiment?: string }> }) {
  const { id } = await params;
  const { experiment } = await searchParams;
  const { project, role, db } = await requireProject();
  const [k] = await db.select().from(s.kols).where(and(eq(s.kols.id, id), eq(s.kols.projectId, project.id)));
  if (!k) notFound();
  let exp = experiment ? (await db.select().from(s.experiments).where(and(eq(s.experiments.id, experiment), eq(s.experiments.projectId, project.id))))[0] : undefined;
  const [camp] = exp ? await db.select().from(s.campaigns).where(eq(s.campaigns.experimentId, exp.id)) : [];
  if (exp && camp?.kolId !== k.id) exp = undefined;
  const saved = !!(camp?.brief && camp.kolId === k.id);
  const b: KolBrief = saved ? (camp!.brief as unknown as KolBrief) : await kolBriefCached(db, k, project.lastCycleAt, exp?.id);

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[
          { label: "Creators", href: "/app/kols" },
          { label: `@${k.handle}`, href: `/app/kols/${k.id}` },
        ]}
        title={<>Campaign brief — {b.creator}</>}
        actions={saved && exp && can(role, "operate") ? <ActionButton action={generateBriefAction.bind(null, k.id, exp.id)} label={priced("Rewrite brief", "campaign_brief")} icon={<RefreshCw />} /> : undefined}
        description="A working document for the creator. Every claim carries a source. Not promotional copy."
        meta={
          <>
            <ModeBadge mode={k.dataMode} />
            {exp ? (
              <span>
                For experiment <span className="num text-ink-2">#{exp.number}</span> · {exp.title}
              </span>
            ) : (
              <span>Not yet tied to an experiment</span>
            )}
            <span className="text-ink-4">·</span>
            <span>{saved ? "Saved with campaign" : "Generated now"}</span>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="min-w-0">
          <CardHeader title="Brief" icon={<FileText />} />
          <Section title="Objective">{b.objective}</Section>
          <Section title="Why this creator">
            <Bullets items={b.whyThisCreator} />
          </Section>
          <Section title="Why now">
            <Bullets items={b.whyNow} />
          </Section>
          <Section title="Audience">{b.audience}</Section>
          <Section title="Current narrative">{b.currentNarrative}</Section>
          <Section title="Core idea">{b.coreIdea}</Section>
          <Section title="Demo worth showing">{b.demoWorthShowing}</Section>
          <Section title="Suggested angles">
            <ol className="list-decimal space-y-1 pl-4 marker:text-ink-4">
              {b.suggestedAngles.map((x, ix) => (
                <li key={`${ix}:${x}`}>{x}</li>
              ))}
            </ol>
          </Section>
          <Section title="Claims with evidence">
            <ul className="space-y-1.5">
              {b.claimsWithEvidence.map((c) => (
                <li key={c.claim + c.source}>
                  {c.claim}
                  <a href={c.source} target={c.source.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[11.5px] text-s1 hover:underline">
                    source{c.source.startsWith("http") && <ArrowUpRight className="size-3" />}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Things to avoid">
            <Bullets items={b.thingsToAvoid} />
          </Section>
          <Section title="CTA">{b.cta}</Section>
          {b.trackingLink && (
            <Section title="Tracking link">
              <CopyField value={b.trackingLink} />
            </Section>
          )}
          <Section title="Compensation">{b.compensation}</Section>
          <Section title="Creator freedom">
            <Badge tone="good">{b.creatorFreedom}</Badge>
          </Section>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Optional drafts" description="Suggestions only — the creator writes in their own voice." icon={<PenLine />} action={<Badge tone={b.draftsGeneratedBy === "claude" ? "info" : "neutral"}>{b.draftsGeneratedBy === "claude" ? "AI-written" : "template"}</Badge>} />
            <CardBody className="space-y-4">
              <Callout tone="warn">{b.disclosure}</Callout>
              {b.drafts.length ? (
                b.drafts.map((d) => (
                  <div key={d.label}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="label">{d.label}</span>
                      <CopyButton value={d.body} />
                    </div>
                    <pre className="whitespace-pre-wrap rounded-[8px] border border-line bg-bg px-3 py-2.5 font-sans text-[12.5px] leading-relaxed text-ink-2">{d.body}</pre>
                  </div>
                ))
              ) : (
                <p className="text-[12.5px] text-ink-3">No drafts were generated for this brief.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
