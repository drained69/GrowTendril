"use client";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, http, keccak256, parseAbi, toHex, type Address, type EIP1193Provider } from "viem";
import { arcTestnet } from "viem/chains";
import { isOutcomeEscrowCode, OUTCOME_ESCROW_ABI } from "@arc-growth/escrow";
import { Button, Field, Input } from "@/components/ui";
import { CopyField } from "@/components/ui/copy";
import { fmtUsdc } from "@/lib/money";
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const ERC20 = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const readonly = createPublicClient({ chain:arcTestnet, transport:http("https://rpc.testnet.arc.io",{timeout:15_000,retryCount:1}) });
export interface EscrowTerms { campaignId:string; termsHash:string; budgetMicro:number; deadline:number; baseMicro:number; qualityBonusMicro:number; outcomeBonusMicro:number; outcomeCap:number; slots:number }
export interface EscrowReward { id:string; recipient:string; score:number; outcomes:number; amountMicro:number; evidenceHash:string }
/** Explicit user wallet confirmations. These controls never call GrowTendril's mainnet payment engine. */
export function EscrowControls({ contract, terms, rewards, canManage }: { contract:string|null; terms:EscrowTerms; rewards:EscrowReward[]; canManage:boolean }) {
  const [arbiter,setArbiter]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[lastHash,setLastHash]=useState<string|null>(null);
  async function action(kind:"approve"|"fund"|"queue"|"claim"|"refund"|"reduce"|"dispute"|"resolveRelease"|"resolveReject",reward?:EscrowReward) {
    setBusy(true);setMessage("");
    let submittedHash: string | null = null;
    try {
      if(!contract || !/^0x[\da-f]{40}$/i.test(contract))throw new Error("Escrow is not configured");
      const provider=(window as unknown as {ethereum?:EIP1193Provider}).ethereum;
      if(!provider)throw new Error("Open a browser with an EVM wallet to use testnet escrow.");
      const client=createWalletClient({chain:arcTestnet,transport:custom(provider)});
      await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:toHex(5042002)}]});
      if(await client.getChainId()!==5042002 || await readonly.getChainId()!==5042002)throw new Error("Select Arc testnet");
      const [account]=await client.requestAddresses();
      if(!account)throw new Error("Connect a wallet");
      const code=await readonly.getCode({address:contract as Address});
      if(!code || !isOutcomeEscrowCode(code))throw new Error("The configured contract does not match the compiled OutcomeRewardsEscrow prototype.");
      const [token,hold]=await Promise.all([readonly.readContract({address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"token"}),readonly.readContract({address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"refundHold"})]);
      if(token.toLowerCase()!==USDC.toLowerCase()||hold!==259200n)throw new Error("Escrow must use testnet USDC and a 72-hour refund hold");
      if(kind==="approve" || kind==="fund") {
        const campaign=await readonly.readContract({address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"campaigns",args:[terms.campaignId as `0x${string}`]});
        if(campaign[0]!=="0x0000000000000000000000000000000000000000")throw new Error("This escrow campaign is already funded");
        if(Date.now()/1000>=terms.deadline)throw new Error("Fund before the campaign ends");
      }
      let hash:`0x${string}`;
      if(kind==="approve") {
        const {request}=await readonly.simulateContract({account,address:USDC,abi:ERC20,functionName:"approve",args:[contract as Address,BigInt(terms.budgetMicro)]});
        hash=await client.writeContract(request);
      } else if(kind==="fund") {
        if(!/^0x[\da-f]{40}$/i.test(arbiter)||/^0x0{40}$/i.test(arbiter)||arbiter.toLowerCase()===account.toLowerCase())throw new Error("Choose a separate, nonzero dispute arbiter wallet");
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"createCampaign",args:[terms.campaignId as `0x${string}`,arbiter as Address,BigInt(terms.deadline),BigInt(terms.budgetMicro),BigInt(terms.baseMicro),BigInt(terms.qualityBonusMicro),BigInt(terms.outcomeBonusMicro),BigInt(terms.outcomeCap),BigInt(terms.slots),terms.termsHash as `0x${string}`]});
        hash=await client.writeContract(request);
      } else if(kind==="queue" && reward) {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"queueReward",args:[terms.campaignId as `0x${string}`,keccak256(toHex(reward.id)),reward.recipient as Address,BigInt(reward.score),BigInt(reward.outcomes),reward.evidenceHash as `0x${string}`]});
        hash=await client.writeContract(request);
      } else if(kind==="claim" && reward) {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"claim",args:[terms.campaignId as `0x${string}`,keccak256(toHex(reward.id))]});
        hash=await client.writeContract(request);
      } else if(kind==="reduce" && reward) {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"reduceOutcomes",args:[terms.campaignId as `0x${string}`,keccak256(toHex(reward.id)),BigInt(reward.outcomes),reward.evidenceHash as `0x${string}`]});
        hash=await client.writeContract(request);
      } else if(kind==="dispute" && reward) {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"dispute",args:[terms.campaignId as `0x${string}`,keccak256(toHex(reward.id))]});
        hash=await client.writeContract(request);
      } else if((kind==="resolveRelease" || kind==="resolveReject") && reward) {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"resolve",args:[terms.campaignId as `0x${string}`,keccak256(toHex(reward.id)),kind==="resolveRelease"]});
        hash=await client.writeContract(request);
      } else if(kind==="refund") {
        const {request}=await readonly.simulateContract({account,address:contract as Address,abi:OUTCOME_ESCROW_ABI,functionName:"refundUnused",args:[terms.campaignId as `0x${string}`]});
        hash=await client.writeContract(request);
      } else throw new Error("Unknown escrow action");
      submittedHash = hash;setLastHash(hash);setMessage("Submitted on Arc testnet. Waiting for confirmation…");
      const receipt=await readonly.waitForTransactionReceipt({hash,timeout:60_000});
      setMessage(receipt.status==="success"?"Confirmed on Arc testnet. This does not settle a mainnet creator reward.":"The testnet transaction reverted.");
    } catch(e) {setMessage(submittedHash?"Could not confirm the action. Check its testnet transaction before retrying.":e instanceof Error?e.message:"Testnet escrow action could not be completed.");}
    finally{setBusy(false);}
  }
  return <div className="space-y-4">
    <p className="text-sm text-ink-2">Testnet prototype · {fmtUsdc(terms.budgetMicro)} test USDC · 72-hour refund hold · seven-day final review window.</p>
    {!contract?<p className="text-sm text-ink-3">The operator must deploy the prototype on Arc testnet and configure its address before funding is available.</p>:<CopyField value={contract} />}
    <CopyField value={terms.campaignId} />
    {canManage&&<><Field label="Independent dispute arbiter" htmlFor="escrow-arbiter"><Input id="escrow-arbiter" value={arbiter} onChange={e=>setArbiter(e.target.value)} placeholder="0x…" disabled={busy} /></Field><div className="flex flex-wrap gap-2"><Button disabled={busy||!contract} onClick={()=>action("approve")}>1. Approve exact test USDC budget</Button><Button disabled={busy||!contract} onClick={()=>action("fund")}>2. Fund testnet escrow</Button><Button disabled={busy||!contract} variant="ghost" onClick={()=>action("refund")}>Return unused test funds</Button></div></>}
    <p className="text-xs text-ink-3">Funds are separate from your workspace wallet and mission commitments. The contract bounds rewards; the business attests quality and customer outcomes. Mainnet payments continue through the existing approval flow.</p>
    {rewards.map(r=><div key={r.id} className="rounded-xl border border-line p-3 space-y-2"><p className="text-sm">{fmtUsdc(r.amountMicro)} · quality {r.score}/100 · {r.outcomes} eligible actions</p><code className="block break-all text-xs">{r.recipient}</code><div className="flex flex-wrap gap-2">{canManage&&<><Button disabled={busy||!contract} onClick={()=>action("queue",r)}>Approve and queue test reward</Button><Button disabled={busy||!contract} variant="ghost" onClick={()=>action("reduce",r)}>Apply refunded outcomes</Button></>}<Button disabled={busy||!contract} variant="ghost" onClick={()=>action("claim",r)}>Claim after refund hold</Button><Button disabled={busy||!contract} variant="ghost" onClick={()=>action("dispute",r)}>Dispute before hold ends</Button>{canManage&&<><Button disabled={busy||!contract} variant="ghost" onClick={()=>action("resolveRelease",r)}>Arbiter: release</Button><Button disabled={busy||!contract} variant="ghost" onClick={()=>action("resolveReject",r)}>Arbiter: reject</Button></>}</div></div>)}
    {message&&<p role="status" className="text-sm text-ink-2">{message}</p>}
    {lastHash&&<a className="break-all text-xs underline" href={`https://explorer.testnet.arc.io/tx/${lastHash}`} target="_blank" rel="noopener noreferrer">View testnet transaction {lastHash}</a>}
  </div>;
}
