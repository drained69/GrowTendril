/**
 * One-time platform setup for agent wallets. Workspace wallets themselves are created in the app
 * (Wallet → Create agent wallet), one Circle wallet per workspace.
 *
 *   npm run wallet:setup -- --entity-secret   generate + register a Circle entity secret (needs CIRCLE_API_KEY)
 *   npm run wallet:setup -- --local           generate a throwaway TESTNET key for local development
 */
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);

if (args.includes("--local")) {
  if ((process.env.GROWTHOS_NETWORK ?? "testnet") === "mainnet") {
    console.error("Development keys are testnet-only. On mainnet use Circle developer-controlled wallets (--entity-secret).");
    process.exit(1);
  }
  const pk = generatePrivateKey();
  console.log("Arc Testnet development key (TESTNET ONLY — never fund it with real assets):\n");
  console.log(`AGENT_PRIVATE_KEY=${pk}`);
  console.log(`# address: ${privateKeyToAccount(pk).address}`);
  console.log("\nFund it at https://faucet.circle.com (Arc Testnet). Workspaces can then attach it from the Wallet page.");
} else if (args.includes("--entity-secret")) {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("Set CIRCLE_API_KEY (TEST_API_KEY:…) from https://console.circle.com first.");
    process.exit(1);
  }
  const { registerEntitySecretCiphertext } = await import("@circle-fin/developer-controlled-wallets");
  // An entity secret is 32 random bytes, hex-encoded (the SDK's generateEntitySecret only prints one).
  const entitySecret = randomBytes(32).toString("hex");
  await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: "." });
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log("Registered with Circle. A recovery file was saved here — back it up and keep it out of git.");
} else {
  console.log("Usage: npm run wallet:setup -- --entity-secret | --local");
}
