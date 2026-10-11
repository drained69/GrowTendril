import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { ARC } from "@/server/integrations/circle/config";

/** On-chain USDC (ERC-20 interface, 6 decimals) held by an address on the configured Arc network. */
export async function arcUsdcBalanceMicro(address: string): Promise<number> {
  if (!ARC.rpcUrl) throw new Error(`No Arc RPC URL for ${ARC.name} — set ARC_RPC_URL`);
  const client = createPublicClient({ transport: http(ARC.rpcUrl) });
  const bal = await client.readContract({ address: ARC.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] });
  return Number(bal);
}
