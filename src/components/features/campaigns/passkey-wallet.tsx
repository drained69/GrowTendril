"use client";
import { useState } from "react";
import { createPublicClient, defineChain } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { WebAuthnMode, toCircleSmartAccount, toModularTransport, toPasskeyTransport, toWebAuthnCredential } from "@circle-fin/modular-wallets-core";
import { beginCreatorWalletAction, verifyCreatorWalletAction } from "@/server/actions/creator-wallet";
import { Button } from "@/components/ui";
export interface PasskeyConfig { enabled: boolean; clientKey: string | null; clientUrl: string | null; chainId: number; rpcUrl: string }
export function PasskeyWallet({ config, username, token, onVerified }: { config:PasskeyConfig; username:string; token:string; onVerified:(address:string,proofId:string)=>void }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  if(!config.enabled || !config.clientKey || !config.clientUrl) return null;
  async function setup(mode:WebAuthnMode) {
    setBusy(true);setError(null);
    try {
      const credential=await toWebAuthnCredential({transport:toPasskeyTransport(config.clientUrl!,config.clientKey!),mode,username});
      const chain=defineChain({id:config.chainId,name:"Arc Mainnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},rpcUrls:{default:{http:[config.rpcUrl]}}});
      const client=createPublicClient({chain,transport:toModularTransport(`${config.clientUrl!.replace(/\/$/,"")}/arc`,config.clientKey!)});
      const account=await toCircleSmartAccount({client,owner:toWebAuthnAccount({credential})});
      const challenge=await beginCreatorWalletAction(token,account.address);
      if(!challenge.ok || !challenge.data) throw new Error(challenge.ok?"No wallet challenge returned":challenge.error);
      const signature=await account.signMessage({message:challenge.data.message});
      const verified=await verifyCreatorWalletAction(challenge.data.id,signature);
      if(!verified.ok)throw new Error(verified.error);
      onVerified(account.address,challenge.data.id);
    } catch {setError("Could not confirm your passkey wallet. Retry or enter a payout address you control.");}
    finally {setBusy(false);}
  }
  return <div className="rounded-xl border border-line p-3 space-y-2"><p className="text-sm">Use a passkey wallet for creator payments.</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={()=>setup(WebAuthnMode.Register)}>{busy?"Confirming…":"Create with passkey"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setup(WebAuthnMode.Login)}>Use existing passkey</Button></div>{error&&<p role="alert" className="text-xs text-critical">{error}</p>}<p className="text-xs text-ink-3">You will confirm wallet control with a signature. Campaign payments still need business approval.</p></div>;
}
