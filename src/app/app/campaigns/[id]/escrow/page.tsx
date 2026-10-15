import { requireProject } from "@/server/auth/current";
import { can } from "@/server/auth/access";
import { escrowPreview } from "@/server/domain/growth/escrow-preview";
import { EscrowControls } from "@/components/features/campaigns/escrow-controls";
import { Card, CardBody, PageHeader, Callout, LinkButton } from "@/components/ui";
export default async function CampaignEscrow({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,{db,project,role}=await requireProject(),preview=await escrowPreview(db,project.id,id);
  return <div className="space-y-4"><PageHeader title="Prefunded campaign escrow" description={preview.title} actions={<LinkButton href={`/app/campaigns/${id}`}>Campaign</LinkButton>} /><Callout title="Arc testnet prototype">Use test funds to evaluate contract funding, bounded reward calculations, refund holds and independent dispute resolution. This contract has local tests and has not undergone an independent audit.</Callout><Card><CardBody><EscrowControls {...preview} canManage={can(role,"approve")} /></CardBody></Card></div>;
}
