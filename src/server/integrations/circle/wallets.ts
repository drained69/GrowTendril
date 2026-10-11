import { eq } from "drizzle-orm";
import { GatewayClient, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { parseUnits, type Hex } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId } from "@/server/lib/ids";
import { circleClient } from "@/server/integrations/circle/client";
import { ARC, IS_MAINNET, platformCustody } from "@/server/integrations/circle/config";
import { localKeyAddress, signerFor } from "@/server/integrations/circle/signer";
import { arcUsdcBalanceMicro } from "@/server/integrations/circle/wallet-balance";
import { gatewayBalance } from "@/server/integrations/circle/gateway";

/**
 * Workspace agent wallets. Each workspace has at most one; it is the operating budget the
 * agent spends from. Keys are never held by GrowthOS in Circle mode, and never reach the
 * browser or an LLM in any mode.
 */

export type Wallet = typeof s.wallets.$inferSelect;

export async function getWallet(db: DB, projectId: string): Promise<Wallet | null> {
  const [w] = await db.select().from(s.wallets).where(eq(s.wallets.projectId, projectId));
  return w ?? null;
}

/** True when the wallet can actually sign and move funds on this deployment. */
export function walletIsLive(w: Wallet | null | undefined): boolean {
  return !!w && w.status === "ACTIVE" && !!signerFor(w);
}

async function upsertWallet(db: DB, projectId: string, v: Partial<typeof s.wallets.$inferInsert> & { provider: string; status: string }) {
  const existing = await getWallet(db, projectId);
  if (existing) {
    await db.update(s.wallets).set({ dataMode: ARC.dataMode, blockchain: ARC.circleBlockchain, frozen: IS_MAINNET || existing.frozen, ...v }).where(eq(s.wallets.id, existing.id));
    return (await getWallet(db, projectId))!;
  }
  // Mainnet wallets start frozen: an owner reviews the spend policy and resumes spending deliberately.
  const [row] = await db.insert(s.wallets).values({ id: newId(), projectId, dataMode: ARC.dataMode, blockchain: ARC.circleBlockchain, frozen: IS_MAINNET, ...v }).returning();
  return row;
}

/** Create a dedicated Circle wallet (EOA on Arc for the configured network) for this workspace. */
export async function provisionWallet(db: DB, a: { projectId: string; userId: string; projectName: string }): Promise<Wallet> {
  const existing = await getWallet(db, a.projectId);
  if (existing && walletIsLive(existing)) return existing;
  const custody = platformCustody();
  if (custody === "circle") {
    const client = await circleClient();
    const set = await client.createWalletSet({ name: `GrowthOS · ${a.projectName}`.slice(0, 60) });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle did not return a wallet set");
    // EOA so x402 EIP-712 authorizations verify with plain ecrecover in Gateway batching.
    const res = await client.createWallets({ walletSetId, blockchains: [ARC.circleBlockchain], count: 1, accountType: "EOA", metadata: [{ name: a.projectName.slice(0, 50), refId: a.projectId }] });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error("Circle did not return a wallet");
    const row = await upsertWallet(db, a.projectId, { provider: "circle_dcw", address: w.address, circleWalletId: w.id, circleWalletSetId: walletSetId, status: "ACTIVE", dataMode: ARC.dataMode });
    await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.provision", target: w.address, data: { custody: "circle" } });
    return row;
  }
  if (custody === "local") {
    const row = await upsertWallet(db, a.projectId, { provider: "local_testnet", address: localKeyAddress(), status: "ACTIVE", dataMode: ARC.dataMode });
    await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.provision", target: row.address ?? "", data: { custody: "local_testnet" } });
    return row;
  }
  throw new Error("No custody configured on this deployment. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
}

/** Attach an existing Circle developer-controlled wallet (must be an Arc wallet on the configured network, under this entity). */
export async function attachCircleWallet(db: DB, a: { projectId: string; userId: string; circleWalletId: string }): Promise<Wallet> {
  const client = await circleClient();
  const res = await client.getWallet({ id: a.circleWalletId });
  const w = res.data?.wallet;
  if (!w) throw new Error("Wallet not found under this Circle entity");
  if (w.blockchain !== ARC.circleBlockchain) throw new Error(`Wallet is on ${w.blockchain}; GrowthOS operates on ${ARC.circleBlockchain}`);
  const row = await upsertWallet(db, a.projectId, { provider: "circle_dcw", address: w.address, circleWalletId: w.id, circleWalletSetId: w.walletSetId, status: "ACTIVE", dataMode: ARC.dataMode });
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.attach", target: w.address });
  return row;
}

export interface WalletBalances {
  walletMicro: number | null;
  gatewayMicro: number | null;
  errors: string[];
}

export async function walletBalances(w: Wallet | null): Promise<WalletBalances> {
  if (!w?.address) return { walletMicro: null, gatewayMicro: null, errors: [] };
  const errors: string[] = [];
  const [onchain, gw] = await Promise.all([
    arcUsdcBalanceMicro(w.address).catch((e: Error) => (errors.push(`Arc RPC: ${e.message.slice(0, 80)}`), null)),
    gatewayBalance(w.address).then((b) => b.availableMicro).catch((e: Error) => (errors.push(`Gateway API: ${e.message.slice(0, 80)}`), null)),
  ]);
  return { walletMicro: onchain, gatewayMicro: gw, errors };
}

/**
 * Move wallet USDC into Circle Gateway so x402 payments can be made by signature.
 * Circle custody: approve + deposit as contract executions. Development key (testnet only): GatewayClient.deposit.
 * Returns the on-chain tx hashes. Long-running — called from the job worker.
 */
export async function depositToGateway(w: Wallet, amount: string): Promise<{ approveTx: string | null; depositTx: string }> {
  const arc = CHAIN_CONFIGS[ARC.x402Chain];
  if (w.provider === "local_testnet") {
    if (IS_MAINNET) throw new Error("Development keys are disabled on mainnet");
    const client = new GatewayClient({ chain: ARC.x402Chain, privateKey: process.env.AGENT_PRIVATE_KEY as Hex });
    const r = await client.deposit(amount);
    return { approveTx: r.approvalTxHash ?? null, depositTx: r.depositTxHash };
  }
  if (w.provider !== "circle_dcw" || !w.circleWalletId) throw new Error("Wallet cannot deposit");
  const client = await circleClient();
  const atomic = parseUnits(amount, 6).toString();
  const run = async (sig: string, params: string[], contract: string) => {
    const tx = await client.createContractExecutionTransaction({ walletId: w.circleWalletId!, contractAddress: contract, abiFunctionSignature: sig, abiParameters: params, fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
    const id = tx.data?.id;
    if (!id) throw new Error(`${sig}: Circle returned no transaction id`);
    // Only an on-chain hash is returned — never Circle's internal transaction id in its place.
    let confirmed = false;
    for (let i = 0; i < 90; i++) {
      const t = await client.getTransaction({ id });
      const st = t.data?.transaction?.state;
      const hash = t.data?.transaction?.txHash;
      if ((st === "COMPLETE" || st === "CONFIRMED") && hash) return hash;
      confirmed ||= st === "COMPLETE" || st === "CONFIRMED";
      // Fast-fail on every terminal non-success state (STUCK included) instead of spinning the full timeout.
      if (st === "FAILED" || st === "CANCELLED" || st === "DENIED") throw new Error(`${sig}: ${st}`);
      if (st === "STUCK") throw new Error(`${sig}: transaction STUCK on-chain (gas/nonce) — check the wallet on the explorer before retrying`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(confirmed ? `${sig}: Circle reports it confirmed but returned no tx hash (Circle tx ${id})` : `${sig}: timed out waiting for confirmation (Circle tx ${id})`);
  };
  const approveTx = await run("approve(address,uint256)", [arc.gatewayWallet, atomic], arc.usdc);
  const depositTx = await run("deposit(address,uint256)", [arc.usdc, atomic], arc.gatewayWallet);
  return { approveTx, depositTx };
}
