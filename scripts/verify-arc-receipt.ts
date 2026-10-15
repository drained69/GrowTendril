import { readFile } from "node:fs/promises";
import { verifyReceipt, type PortableReceipt } from "../packages/arc-growth-tools/src/evidence";
const [receiptPath, trustedKeysPath] = process.argv.slice(2);
if (!receiptPath || !trustedKeysPath) throw new Error("Usage: npm run arc:verify-receipt -- receipt.json trusted-keys.json");
const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as PortableReceipt;
const trustedKeys = JSON.parse(await readFile(trustedKeysPath, "utf8")) as Record<string, { issuer: string; publicKey: string }>;
const result = verifyReceipt(receipt, trustedKeys);
console.log(JSON.stringify(result));
if (!result.integrity || !result.authenticated) process.exitCode = 1;
