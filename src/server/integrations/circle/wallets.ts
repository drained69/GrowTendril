import { and, eq, ne, or, sql } from "drizzle-orm";
import { parseUnits } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/db/helpers";
import { newId, sha256 } from "@/server/lib/ids";
import { circleClient } from "@/server/integrations/circle/client";
import { ARC, platformCustody } from "@/server/integrations/circle/config";
import { signerFor } from "@/server/integrations/circle/signer";
import { arcUsdcBalanceMicro } from "@/server/integrations/circle/wallet-balance";
import { gatewayBalance } from "@/server/integrations/circle/gateway";

/**
 * Workspace agent wallets. Each workspace has at most one; it is the operating budget the
 * agent spends from. Keys are never held by GrowTendril in Circle mode, and never reach the
 * browser or an LLM in any mode.
 */

export type Wallet = typeof s.wallets.$inferSelect;

export async function getWallet(db: DB, projectId: string): Promise<Wallet | null> {
  const [w] = await db.select().from(s.wallets).where(eq(s.wallets.projectId, projectId));
  return w ?? null;
}

/** True when the wallet can actually sign and move funds on this deployment. */
export function walletIsLive(w: Wallet | null | undefined): boolean {
  return !!w && w.status === "ACTIVE" && w.blockchain === ARC.circleBlockchain && w.dataMode === "LIVE" && !!signerFor(w);
}

async function upsertWallet(db: DB, projectId: string, v: Partial<typeof s.wallets.$inferInsert> & { provider: string; status: string }) {
  return db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`financial:${projectId}`}))`);
  if (v.circleWalletId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`circle-wallet:${v.circleWalletId}`}))`);
  const db = tx as unknown as DB;
  const [other] = await db.select({ id: s.wallets.id }).from(s.wallets).where(and(ne(s.wallets.projectId, projectId), or(v.circleWalletId ? eq(s.wallets.circleWalletId, v.circleWalletId) : undefined, v.address ? sql`lower(${s.wallets.address}) = ${v.address.toLowerCase()}` : undefined)));
  if (other) throw new Error("That wallet already belongs to another workspace");
  const existing = await getWallet(db, projectId);
  if (existing) {
    if ((existing.circleWalletId && existing.circleWalletId !== v.circleWalletId) || (existing.address && existing.address.toLowerCase() !== v.address?.toLowerCase())) throw new Error("This workspace already has a different wallet. Use a new workspace so historical payments retain their original wallet.");
    await db.update(s.wallets).set(v).where(eq(s.wallets.id, existing.id));
    return (await getWallet(db, projectId))!;
  }
  const [row] = await db.insert(s.wallets).values({ id: newId(), projectId, blockchain: ARC.circleBlockchain, dataMode: "LIVE", ...v }).returning();
  return row;
  });
}

const walletRequestId = (projectId: string, operation: string) => {
  const h = sha256(`growtendril-wallet:${operation}:${projectId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Create a dedicated Circle wallet (EOA on Arc mainnet) for this workspace. */
export async function provisionWallet(db: DB, a: { projectId: string; userId: string; projectName: string }): Promise<Wallet> {
  const existing = await getWallet(db, a.projectId);
  if (existing?.blockchain !== undefined && existing.blockchain !== ARC.circleBlockchain) throw new Error("This workspace has a testnet wallet. Create a new workspace for Arc mainnet so the existing wallet record is preserved.");
  if (existing?.status === "ACTIVE" && existing.circleWalletId) return existing;
  const custody = platformCustody();
  if (custody === "circle") {
    const client = await circleClient();
    const set = await client.createWalletSet({ name: `GrowTendril · ${a.projectName}`.slice(0, 60), idempotencyKey: walletRequestId(a.projectId, "set") });
    const walletSetId = set.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle did not return a wallet set");
    // EOA so x402 EIP-712 authorizations verify with plain ecrecover in Gateway batching.
    const res = await client.createWallets({ walletSetId, blockchains: [ARC.circleBlockchain], count: 1, accountType: "EOA", metadata: [{ name: a.projectName.slice(0, 50), refId: a.projectId }], idempotencyKey: walletRequestId(a.projectId, "wallet") });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error("Circle did not return a wallet");
    const row = await upsertWallet(db, a.projectId, { provider: "circle_dcw", address: w.address, circleWalletId: w.id, circleWalletSetId: walletSetId, blockchain: ARC.circleBlockchain, status: "ACTIVE", dataMode: "LIVE" });
    await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.provision", target: w.address, data: { custody: "circle" } });
    return row;
  }
  throw new Error("No custody configured on this deployment. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
}

/** Attach an existing Circle developer-controlled wallet on Arc mainnet. */
export async function attachCircleWallet(db: DB, a: { projectId: string; userId: string; circleWalletId: string }): Promise<Wallet> {
  const client = await circleClient();
  const res = await client.getWallet({ id: a.circleWalletId });
  const w = res.data?.wallet;
  if (!w) throw new Error("Wallet not found under this Circle entity");
  if (w.blockchain !== ARC.circleBlockchain) throw new Error(`Wallet is on ${w.blockchain}; GrowTendril operates on ${ARC.circleBlockchain}`);
  if (w.refId !== a.projectId) throw new Error("This Circle wallet is not assigned to this workspace. Its Circle refId must match the workspace ID.");
  if (w.state !== "LIVE" || w.accountType !== "EOA") throw new Error("Attach a live EOA wallet so the agent can sign Arc payments");
  const row = await upsertWallet(db, a.projectId, { provider: "circle_dcw", address: w.address, circleWalletId: w.id, circleWalletSetId: w.walletSetId, blockchain: ARC.circleBlockchain, status: "ACTIVE", dataMode: "LIVE" });
  await audit(db, { projectId: a.projectId, actorType: "user", actorId: a.userId, action: "wallet.attach", target: w.address });
  return row;
}

export interface WalletBalances {
  walletMicro: number | null;
  gatewayMicro: number | null;
  errors: string[];
}

export async function walletBalances(w: Wallet | null): Promise<WalletBalances> {
  if (!w?.address || w.blockchain !== ARC.circleBlockchain) return { walletMicro: null, gatewayMicro: null, errors: [] };
  const errors: string[] = [];
  const [onchain, gw] = await Promise.all([
    arcUsdcBalanceMicro(w.address).catch((e: Error) => (errors.push(`Arc RPC: ${e.message.slice(0, 80)}`), null)),
    gatewayBalance(w.address).then((b) => b.availableMicro).catch((e: Error) => (errors.push(`Gateway API: ${e.message.slice(0, 80)}`), null)),
  ]);
  return { walletMicro: onchain, gatewayMicro: gw, errors };
}

/**
 * Move wallet USDC into Circle Gateway so x402 payments can be made by signature.
 * Circle custody: approve + deposit as contract executions.
 * Returns the on-chain tx hashes. Long-running — called from the job worker.
 */
export async function depositToGateway(w: Wallet, amount: string): Promise<{ approveTx: string | null; depositTx: string }> {
  if (w.frozen || w.status !== "ACTIVE") throw new Error("Wallet is frozen or inactive");
  if (w.blockchain !== ARC.circleBlockchain || w.dataMode !== "LIVE") throw new Error("A matching Arc mainnet wallet is required for deposits");
  if (w.provider !== "circle_dcw" || !w.circleWalletId) throw new Error("Wallet cannot deposit");
  const client = await circleClient();
  const atomic = parseUnits(amount, 6).toString();
  const run = async (sig: string, params: string[], contract: string) => {
    const tx = await client.createContractExecutionTransaction({ walletId: w.circleWalletId!, contractAddress: contract, abiFunctionSignature: sig, abiParameters: params, fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
    const id = tx.data?.id;
    if (!id) throw new Error(`${sig}: Circle returned no transaction id`);
    for (let i = 0; i < 90; i++) {
      const t = await client.getTransaction({ id });
      const st = t.data?.transaction?.state;
      const hash = t.data?.transaction?.txHash;
      if ((st === "COMPLETE" || st === "CONFIRMED") && hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) return hash;
      if (st === "FAILED" || st === "CANCELLED" || st === "DENIED") throw new Error(`${sig}: ${st}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${sig}: timed out waiting for confirmation`);
  };
  const approveTx = await run("approve(address,uint256)", [ARC.gatewayWallet, atomic], ARC.usdc);
  const depositTx = await run("deposit(address,uint256)", [ARC.usdc, atomic], ARC.gatewayWallet);
  return { approveTx, depositTx };
}
