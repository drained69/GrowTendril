import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import * as s from "@/server/db/schema";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, LinkButton } from "@/components/ui";
import { CampaignForm } from "@/components/features/campaigns/forms";
import { fmtUsdc, microToDecimal } from "@/lib/money";
import { loadPolicy } from "@/server/domain/agent/ledger";
export default async function Campaigns() {
  const { db, project, role } = await requireProject();
  const policy = await loadPolicy(db, project.id);
  const rows = await db.select({ program: s.creatorPrograms, experiment: s.experiments }).from(s.creatorPrograms)
    .innerJoin(s.experiments, eq(s.experiments.id, s.creatorPrograms.experimentId)).where(eq(s.creatorPrograms.projectId, project.id)).orderBy(desc(s.creatorPrograms.createdAt));
  return <div className="space-y-6">
    <PageHeader title="Creator campaigns" description="Fund useful creator work. See the post, the reward calculation and the customer actions behind every payment." actions={<LinkButton href="/app/kols">Find creators</LinkButton>} />
    <div className="grid gap-4 md:grid-cols-2">{rows.map(({program:p,experiment:e}) => <Link href={`/app/campaigns/${p.id}`} key={p.id}><Card interactive><CardBody><div className="flex justify-between gap-3"><h2 className="font-semibold">{e.title}</h2><StatusBadge status={e.status} /></div><p className="mt-2 text-sm text-ink-3">{p.topic} · {p.platform} · {p.slots} creator slots</p><p className="mt-4 text-xl font-semibold">{fmtUsdc(e.budgetMicro)} <span className="text-xs font-normal text-ink-3">reward pool</span></p><p className="mt-2 text-xs text-ink-3">Target: {e.successTarget} {e.successEvent.replace(/_/g," ")} · maximum {fmtUsdc(e.stopMaxCpaMicro)} per action</p></CardBody></Card></Link>)}</div>
    {can(role,"manage_policy") ? <Card id="new"><CardHeader title={rows.length ? "Start another campaign" : "Your first creator campaign"} icon={<Megaphone />} description="Define your economics and reward terms. Campaigns run for 14 days." /><CardBody><CampaignForm paymentCeilingUsdc={microToDecimal(policy.hardCeilingMicro)} /></CardBody></Card> : <p className="text-sm text-ink-3">A workspace owner or admin can create a campaign and reserve its reward pool.</p>}
  </div>;
}
