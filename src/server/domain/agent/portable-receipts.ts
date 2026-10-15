import { createHash, createPublicKey } from "node:crypto";
import { createReceipt } from "@arc-growth/evidence";
export function receiptIssuer() {
  const issuer = process.env.APP_URL?.replace(/\/$/, "") || "growtendril-local";
  const privateKey = process.env.ARC_RECEIPT_SIGNING_KEY?.replace(/\\n/g, "\n");
  if (!privateKey) return { issuer, keyId: "unsigned", privateKey: undefined, publicKey: null };
  const key = createPublicKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("ARC_RECEIPT_SIGNING_KEY must be Ed25519");
  const publicKey = key.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(publicKey).digest("hex").slice(0, 24);
  return { issuer, keyId, privateKey, publicKey };
}
export function portableReceipt(body: Record<string, unknown>) {
  const config = receiptIssuer();
  return createReceipt(body, config.issuer, config.keyId, config.privateKey);
}
