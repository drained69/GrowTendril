"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCommerceAction } from "@/server/actions/commerce";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/ui/toast";
export function CommerceForm({ canManage, mainnetChainId, connection }: { canManage: boolean; mainnetChainId: number; connection: { chainId: number; contract: string; merchantAddress: string } | null }) {
  const [pending, start] = useTransition(), router = useRouter();
  return <form method="post" className="grid gap-3 sm:grid-cols-2" onSubmit={e => {
    e.preventDefault(); const fields = Object.fromEntries(new FormData(e.currentTarget));
    start(async () => { const r = await saveCommerceAction(fields); if (r.ok) { toast.success(r.message ?? "Saved"); router.refresh(); } else toast.error(r.error); });
  }}>
    <Field label="Network" htmlFor="commerce-chain"><select id="commerce-chain" name="chainId" defaultValue={connection?.chainId ?? 5042002} disabled={!canManage || pending} className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"><option value={5042002}>Arc testnet · test payments</option><option value={mainnetChainId}>Arc mainnet · real payments</option></select></Field>
    <Field label="Merchant wallet" htmlFor="commerce-merchant"><Input id="commerce-merchant" name="merchantAddress" defaultValue={connection?.merchantAddress} placeholder="0x…" required disabled={!canManage || pending} /></Field>
    <Field label="Commerce escrow contract" htmlFor="commerce-contract"><Input id="commerce-contract" name="contract" defaultValue={connection?.contract} placeholder="0x…" required disabled={!canManage || pending} /></Field>
    <div className="flex items-end"><Button type="submit" disabled={!canManage || pending}>{pending ? "Saving…" : "Connect merchant"}</Button></div>
  </form>;
}
