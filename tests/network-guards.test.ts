import { afterEach, describe, expect, it } from "vitest";
import { ARC, IS_MAINNET, circleKeyEnvironment, custodyProblem, platformCustody } from "@/server/integrations/circle/config";
import { signerFor } from "@/server/integrations/circle/signer";

// Runs under both networks in CI (GROWTENDRIL_NETWORK=testnet and =mainnet); expectations follow the active one.
const saved = { key: process.env.CIRCLE_API_KEY, secret: process.env.CIRCLE_ENTITY_SECRET };
afterEach(() => {
  process.env.CIRCLE_API_KEY = saved.key;
  process.env.CIRCLE_ENTITY_SECRET = saved.secret;
  if (saved.key === undefined) delete process.env.CIRCLE_API_KEY;
  if (saved.secret === undefined) delete process.env.CIRCLE_ENTITY_SECRET;
});

describe("Circle key ↔ network", () => {
  it("reads the environment from the key prefix", () => {
    expect(circleKeyEnvironment("TEST_API_KEY:a:b")).toBe("test");
    expect(circleKeyEnvironment("LIVE_API_KEY:a:b")).toBe("live");
    expect(circleKeyEnvironment("something-else")).toBe("unknown");
    expect(circleKeyEnvironment("")).toBe(null);
  });

  it("refuses a key for the other network and accepts the matching one", () => {
    process.env.CIRCLE_ENTITY_SECRET = "00".repeat(32);
    const right = IS_MAINNET ? "LIVE_API_KEY:a:b" : "TEST_API_KEY:a:b";
    const wrong = IS_MAINNET ? "TEST_API_KEY:a:b" : "LIVE_API_KEY:a:b";

    process.env.CIRCLE_API_KEY = right;
    expect(custodyProblem()).toBeNull();
    expect(platformCustody()).toBe("circle");

    process.env.CIRCLE_API_KEY = wrong;
    expect(custodyProblem()).toMatch(IS_MAINNET ? /TEST key/ : /LIVE key/);
    expect(platformCustody()).toBeNull();
  });
});

describe("wallets never sign on the other network", () => {
  const other = IS_MAINNET ? "ARC-TESTNET" : "ARC";
  const circleWallet = (blockchain: string) => ({ provider: "circle_dcw", address: "0x0000000000000000000000000000000000000001", circleWalletId: "w-1", blockchain });

  it("signs with a wallet created on this network", () => {
    expect(signerFor(circleWallet(ARC.circleBlockchain))?.kind).toBe("circle_dcw");
  });

  it("refuses a wallet created on the other network", () => {
    expect(signerFor(circleWallet(other))).toBeNull();
  });
});
