import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createPublicClient, http, type Address, type Hex } from "viem";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ARC } from "@/server/integrations/circle/config";
import { newId } from "@/server/lib/ids";
import { recipientMessage } from "@arc-growth/recipient";
import { invitation } from "@/server/domain/growth/creator-campaigns";

export function creatorPasskeyConfig() {
  const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
  const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;
  // The signed recipient is used for mainnet campaigns; a testnet-only modular endpoint must not be substituted.
  const enabled = !!clientKey && !!clientUrl && process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CHAIN_ID === String(ARC.chainId);
  return { enabled, clientKey: enabled ? clientKey! : null, clientUrl: enabled ? clientUrl! : null, chainId: ARC.chainId, rpcUrl: ARC.publicRpcUrl };
}
export async function beginRecipientChallenge(db: DB, userId: string, token: string, address: string) {
  if (!creatorPasskeyConfig().enabled) throw new Error("Mainnet creator passkey wallets are not configured on this deployment");
  if (!/^0x[\da-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address)) throw new Error("Invalid payout address");
  const inv = await invitation(db, token);
  if (!inv || inv.participant.userId) throw new Error("Invitation is unavailable");
  const id = newId(), expiresAt = new Date(Date.now() + 5 * 60_000);
  const message = recipientMessage({ issuer: process.env.APP_URL || "growtendril-local", userId, invitationId: inv.participant.id, chainId: ARC.chainId, address, nonce: randomBytes(32).toString("hex"), expiresAt: expiresAt.toISOString() });
  await db.insert(s.creatorWalletChallenges).values({ id, userId, participantId: inv.participant.id, address: address.toLowerCase(), chainId: ARC.chainId, message, expiresAt });
  return { id, message };
}
export async function verifyRecipientChallenge(db: DB, userId: string, id: string, signature: string, verify = async (address: string, message: string, signature: string) => {
  const client = createPublicClient({ transport: http(ARC.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  if (await client.getChainId() !== ARC.chainId) throw new Error("Unexpected verification network");
  // viem's public-client verifier supports EOA, ERC-1271 and counterfactual ERC-6492 signatures.
  return client.verifyMessage({ address: address as Address, message, signature: signature as Hex });
}) {
  if (!/^0x[\da-f]+$/i.test(signature) || signature.length > 30_000) throw new Error("Invalid wallet signature");
  const [c] = await db.select().from(s.creatorWalletChallenges).where(and(eq(s.creatorWalletChallenges.id, id), eq(s.creatorWalletChallenges.userId, userId), isNull(s.creatorWalletChallenges.consumedAt), gt(s.creatorWalletChallenges.expiresAt, new Date())));
  if (!c || c.chainId !== ARC.chainId || !await verify(c.address, c.message, signature)) throw new Error("Wallet ownership could not be verified");
  const changed = await db.update(s.creatorWalletChallenges).set({ verifiedAt: new Date() }).where(and(eq(s.creatorWalletChallenges.id,id), isNull(s.creatorWalletChallenges.consumedAt), gt(s.creatorWalletChallenges.expiresAt,new Date()))).returning({id:s.creatorWalletChallenges.id});
  if (!changed.length) throw new Error("Wallet challenge expired");
}
/** Consume under the campaign financial lock. A proof cannot be moved to a different user, invite or address. */
export async function consumeRecipientProof(db: DB, userId: string, participantId: string, address: string, id: string) {
  const rows = await db.update(s.creatorWalletChallenges).set({ consumedAt: new Date() }).where(and(eq(s.creatorWalletChallenges.id,id), eq(s.creatorWalletChallenges.userId,userId), eq(s.creatorWalletChallenges.participantId,participantId), eq(s.creatorWalletChallenges.address,address.toLowerCase()), eq(s.creatorWalletChallenges.chainId,ARC.chainId), sql`${s.creatorWalletChallenges.verifiedAt} is not null`, isNull(s.creatorWalletChallenges.consumedAt), gt(s.creatorWalletChallenges.expiresAt,new Date()))).returning({id:s.creatorWalletChallenges.id});
  if (!rows.length) throw new Error("The passkey proof does not match this payout address and invitation");
}
