/** Read-only checks for the production Circle and Arc money path. No rows or funds are changed. */
import "./env";
import { isAddress } from "../src/server/domain/billing/arc";

type Result = { ok: boolean; detail: string };
const results: Result[] = [];
async function check(name: string, failure: string, run: () => Promise<string>): Promise<boolean> {
  try {
    const detail = await run();
    console.log(`PASS ${name}: ${detail}`);
    results.push({ ok: true, detail: name });
    return true;
  } catch {
    // SDK and HTTP errors can contain request headers or keys. Print only fixed, safe guidance.
    console.log(`FAIL ${name}: ${failure}`);
    results.push({ ok: false, detail: name });
    return false;
  }
}

async function main() {
  if (process.argv.length > 2) throw new Error("doctor accepts no write flags; it only performs read-only checks");
  const { ARC, circleKeyEnvironment, custodyProblem } = await import("../src/server/integrations/circle/config");
  console.log(`GrowTendril money-path doctor — Arc mainnet (${ARC.chainId})`);
  const keyOk = await check("Circle API key network", "set a complete LIVE_API_KEY in CIRCLE_API_KEY", async () => {
    if (circleKeyEnvironment() !== "live" || custodyProblem()) throw new Error();
    return "LIVE key format";
  });
  const secretOk = await check("Circle entity secret", "set the registered CIRCLE_ENTITY_SECRET", async () => {
    if (!/^[0-9a-fA-F]{64}$/.test(process.env.CIRCLE_ENTITY_SECRET ?? "")) throw new Error();
    return "64-character secret present";
  });

  if (keyOk && secretOk) {
    await check("Circle API and entity public key", "Circle request failed; verify API key, entity-secret registration and network access", async () => {
      const { circleClient } = await import("../src/server/integrations/circle/client");
      const response = await (await circleClient()).getPublicKey();
      if (!response.data?.publicKey) throw new Error();
      return "public key returned";
    });
    await check("Circle wallet sets", "Circle wallet-set listing failed", async () => {
      const { circleClient } = await import("../src/server/integrations/circle/client");
      const response = await (await circleClient()).listWalletSets();
      return `${response.data?.walletSets?.length ?? 0} set(s) listed`;
    });
  } else {
    console.log("SKIP Circle API and wallet sets: credentials incomplete");
  }

  let walletAddress: string | null = null;
  if (process.env.DATABASE_URL) {
    await check("workspace wallet", "read-only wallet lookup failed", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN TRANSACTION READ ONLY");
          const rows = await client.query<{ address: string }>("SELECT address FROM wallets WHERE blockchain = 'ARC' AND data_mode = 'LIVE' AND status = 'ACTIVE' AND address IS NOT NULL ORDER BY created_at DESC LIMIT 1");
          walletAddress = rows.rows[0]?.address ?? null;
          await client.query("ROLLBACK");
        } finally { client.release(); }
      } finally { await pool.end(); }
      if (!walletAddress || !isAddress(walletAddress)) throw new Error();
      return "active Arc mainnet wallet found";
    });
  } else {
    console.log("SKIP workspace wallet: DATABASE_URL is unset");
  }

  await check("Arc RPC", "Arc mainnet RPC is unreachable", async () => {
    const { currentBlock } = await import("../src/server/domain/billing/arc");
    const height = await currentBlock();
    if (height <= 0n) throw new Error();
    return `block ${height}`;
  });

  if (walletAddress) {
    const address = walletAddress;
    await check("Arc wallet USDC balance", "Arc wallet balance lookup failed", async () => {
      const { arcUsdcBalanceMicro } = await import("../src/server/integrations/circle/wallet-balance");
      return `${(await arcUsdcBalanceMicro(address)) / 1_000_000} USDC`;
    });
    await check("Gateway wallet balance", "Gateway balance endpoint is unreachable", async () => {
      const { gatewayBalance } = await import("../src/server/integrations/circle/gateway");
      return `${(await gatewayBalance(address)).availableMicro / 1_000_000} USDC`;
    });
  } else {
    console.log("SKIP Arc wallet and Gateway balances: no active Arc wallet found");
  }
  const failures = results.filter((result) => !result.ok).length;
  console.log(`Doctor: ${results.length - failures} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(() => {
  console.error("Doctor could not start. Check its arguments and environment; no changes were made.");
  process.exitCode = 1;
});
