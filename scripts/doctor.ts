/**
 * GrowTendril money-path doctor. Exercises each Circle/Arc integration in order against the real
 * network, using the SAME functions the app uses, and prints a clear PASS/FAIL per step so a first
 * live run shows exactly where (and why) it stops — instead of failing deep inside the UI.
 *
 *   npm run doctor                 config + Circle API + Arc RPC + Gateway API (read-only, no writes)
 *   npm run doctor -- --provision  also create a Circle wallet on Arc (no funds move)
 *   npm run doctor -- --deposit 1  also deposit 1 USDC into Circle Gateway (needs a funded wallet)
 *   npm run doctor -- --x402       also buy from the bundled x402 seller (needs Gateway balance + seller running)
 *
 * Nothing moves money unless you pass --deposit or --x402. Runs on an in-memory DB; your real data
 * is untouched. Honest by design: it never fabricates a result — a blocked host is reported as blocked.
 */
import { loadedEnv } from "./env";

// The doctor writes scratch rows, so it always uses a throwaway in-memory database, never DATABASE_URL.
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = "memory://";
process.env.ENCRYPTION_KEY ??= "00".repeat(32); // scratch DB only; no real secrets are read from it

const args = process.argv.slice(2);
const want = (flag: string) => args.includes(flag);
const depositAmount = (() => {
  const i = args.indexOf("--deposit");
  return i >= 0 ? args[i + 1] : null;
})();

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", X = "\x1b[0m";
let failed = 0;
let skipped = 0;

async function step(name: string, run: () => Promise<string>) {
  process.stdout.write(`  ${name} … `);
  try {
    const detail = await run();
    console.log(`${G}PASS${X} ${D}${detail}${X}`);
  } catch (e) {
    failed++;
    const msg = ((e as Error).message ?? String(e)).split("\n")[0].slice(0, 200);
    console.log(`${R}FAIL${X} ${msg}`);
  }
}
function skip(name: string, why: string) {
  skipped++;
  console.log(`  ${name} … ${Y}SKIP${X} ${D}${why}${X}`);
}

async function main() {
  const { ARC, GATEWAY_API, DISCOVERY_API, platformCustody, networkInfo } = await import("../src/server/integrations/circle/config");
  const net = networkInfo();
  console.log(`\nGrowTendril money-path doctor — ${net.name} (chain ${net.chainId})`);
  if (net.mainnet) console.log(`${Y}  MAINNET: real funds. --deposit and --x402 move real USDC.${X}`);
  console.log(`${D}  env files    ${loadedEnv.length ? loadedEnv.join(", ") : "none found (using the shell environment only)"}\n  Gateway API ${GATEWAY_API}\n  Arc RPC     ${ARC.rpcUrl}\n  Discovery   ${DISCOVERY_API}${X}\n`);

  const custody = platformCustody();
  console.log("Configuration");
  await step("custody configured", async () => {
    if (!custody) throw new Error("no custody — set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (or AGENT_PRIVATE_KEY on testnet)");
    return custody === "circle" ? "Circle developer-controlled wallets" : "server-side testnet key";
  });

  // ---- Circle Wallets API (key + entity secret) ----
  console.log("\nCircle Wallets API");
  let circleOk = false;
  if (custody !== "circle") {
    skip("API reachable", "custody is not Circle");
    skip("entity secret registered", "custody is not Circle");
  } else {
    const { circleClient } = await import("../src/server/integrations/circle/client");
    await step("entity secret registered (getPublicKey)", async () => {
      const client = await circleClient();
      const r = await client.getPublicKey();
      const key = r.data?.publicKey;
      if (!key) throw new Error("no public key returned — is the entity secret registered? run: npm run wallet:setup -- --entity-secret");
      circleOk = true;
      return "API key + entity secret valid";
    });
    await step("list wallet sets", async () => {
      const { circleClient: cc } = await import("../src/server/integrations/circle/client");
      const client = await cc();
      const r = await client.listWalletSets();
      return `${r.data?.walletSets?.length ?? 0} wallet set(s)`;
    });
  }

  // ---- Scratch workspace for the wallet-touching steps ----
  const { getDb, schema: s } = await import("../src/server/db/client");
  const { newId } = await import("../src/server/lib/ids");
  const db = await getDb();
  const uid = newId();
  const pid = newId();
  await db.insert(s.users).values({ id: uid, email: `doctor-${uid}@local`, name: "Doctor", passwordHash: "x", isGuest: true });
  await db.insert(s.projects).values({ id: pid, ownerId: uid, name: "Doctor", webhookSecret: "x", dataMode: net.mainnet ? "LIVE" : "TESTNET" });

  const { getWallet, provisionWallet, depositToGateway } = await import("../src/server/integrations/circle/wallets");
  const { localKeyAddress } = await import("../src/server/integrations/circle/signer");

  // ---- Provision (optional) ----
  console.log("\nWallet");
  let address: string | null = custody === "local" ? localKeyAddress() : null;
  if (want("--provision")) {
    if (!custody) skip("provision wallet", "no custody");
    else
      await step("provision wallet on Arc", async () => {
        const w = await provisionWallet(db, { projectId: pid, userId: uid, projectName: "Doctor" });
        address = w.address;
        return `${w.provider} ${w.address}`;
      });
  } else if (custody === "circle") {
    skip("provision wallet", "pass --provision to create one (no funds move)");
  }

  // ---- Reads that need an address. Call each endpoint directly so a blocked host fails loudly. ----
  console.log("\nBalances");
  const { arcUsdcBalanceMicro } = await import("../src/server/integrations/circle/wallet-balance");
  const { gatewayBalance } = await import("../src/server/integrations/circle/gateway");
  if (!address) {
    skip("Arc RPC — on-chain USDC", "no wallet address (run with --provision, or use testnet key custody)");
    skip("Gateway API — available balance", "no wallet address");
  } else {
    const addr = address;
    await step("Arc RPC — on-chain USDC", async () => `${fmt(await arcUsdcBalanceMicro(addr))} USDC at ${addr.slice(0, 8)}…`);
    await step("Gateway API — available balance", async () => `${fmt((await gatewayBalance(addr)).availableMicro)} USDC spendable via x402`);
  }

  // ---- Deposit (optional, moves funds) ----
  console.log("\nGateway deposit");
  if (!depositAmount) skip("deposit to Gateway", "pass --deposit <amount> to move USDC into Gateway");
  else if (!address) skip("deposit to Gateway", "no wallet — run with --provision first");
  else {
    const w = await getWallet(db, pid);
    await step(`deposit ${depositAmount} USDC`, async () => {
      if (!/^\d+(\.\d{1,6})?$/.test(depositAmount)) throw new Error("amount must look like 1 or 2.5");
      const r = await depositToGateway(w!, depositAmount);
      return `deposit tx ${r.depositTx}${r.approveTx ? ` (approve ${r.approveTx})` : ""}`;
    });
  }

  // ---- x402 purchase (optional, moves ~cents) ----
  console.log("\nx402 purchase (bundled seller)");
  if (!want("--x402")) skip("x402 quote + pay", "pass --x402 to test a real purchase (needs Gateway balance)");
  else if (!address) skip("x402 quote + pay", "no wallet — run with --provision first");
  else {
    const { SIGNALS_API_URL } = await import("../src/server/integrations/circle/marketplace");
    const { quote, pay } = await import("../src/server/integrations/circle/x402");
    const { signerFor } = await import("../src/server/integrations/circle/signer");
    const w = await getWallet(db, pid);
    let quoted: import("../src/server/integrations/circle/x402").X402Quote | null = null;
    await step("quote /v1/company-intel", async () => {
      const q = await quote(`${SIGNALS_API_URL}/v1/company-intel?company=doctor`);
      if (q.kind === "unsupported") throw new Error(q.reason + ` (is the seller running at ${SIGNALS_API_URL}? set SIGNALS_SELLER_ADDRESS)`);
      if (q.kind === "free") throw new Error("seller returned no paywall — set SIGNALS_SELLER_ADDRESS so it charges");
      quoted = q.quote;
      return `price ${fmt(q.quote.amountMicro)} USDC → ${q.quote.payTo}`;
    });
    if (quoted) {
      const qq: import("../src/server/integrations/circle/x402").X402Quote = quoted;
      await step("pay (sign EIP-712 + settle)", async () => {
        const signer = signerFor(w);
        if (!signer) throw new Error("wallet cannot sign on this deployment");
        const r = await pay(qq, signer, { maxAmountMicro: qq.amountMicro });
        return `settlement ${r.settlementId} · paid ${fmt(r.amountMicro)} USDC`;
      });
    }
  }

  console.log(`\n${failed ? R : G}${failed ? `${failed} step(s) failed` : "all run steps passed"}${X}${skipped ? ` ${D}· ${skipped} skipped${X}` : ""}\n`);
  process.exit(failed ? 1 : 0);
}

function fmt(micro: number | null | undefined): string {
  return micro == null ? "?" : (micro / 1_000_000).toFixed(2);
}

main().catch((e) => {
  console.error(`\n${R}doctor crashed:${X} ${(e as Error).stack ?? e}`);
  process.exit(1);
});
