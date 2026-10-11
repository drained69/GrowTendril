import { createPublicClient, http } from "viem";
import { ARC } from "@/server/integrations/circle/config";
import { TRANSFER, currentBlock } from "@/server/domain/billing/arc";
(async () => {
  const to = "0x8366a39CC670B4001A1121B8F6A443A643e40951" as `0x${string}`;
  const c = createPublicClient({ transport: http(ARC.rpcUrl) });
  const n = await currentBlock();
  const old = await c.getLogs({ address: ARC.usdc as `0x${string}`, event: TRANSFER, args: { to }, fromBlock: n - 6000n, toBlock: n - 4000n });
  const fresh = await c.getLogs({ address: ARC.usdc as `0x${string}`, event: TRANSFER, args: { to }, fromBlock: n - 30n, toBlock: n });
  const other = await c.getLogs({ address: ARC.usdc as `0x${string}`, event: TRANSFER, fromBlock: n - 30n, toBlock: n });
  const pick = (ls: typeof old, min = 29_000_000n) => ls.find((l) => (l.args.value ?? 0n) >= min);
  const o = pick(old), f = pick(fresh), x = other.find((l) => l.args.to?.toLowerCase() !== to.toLowerCase() && (l.args.value ?? 0n) > 0n);
  console.log(JSON.stringify({ now: n.toString(), beforeInvoice: o && { tx: o.transactionHash, usdc: Number(o.args.value) / 1e6 }, fresh: f && { tx: f.transactionHash, usdc: Number(f.args.value) / 1e6, block: f.blockNumber.toString() }, otherAddress: x && { tx: x.transactionHash } }));
  process.exit(0);
})();
