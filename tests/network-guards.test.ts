import { afterEach, describe, expect, it } from "vitest";
import { circleKeyEnvironment, custodyProblem, platformCustody } from "@/server/integrations/circle/config";
import { signerFor } from "@/server/integrations/circle/signer";
import { entitySecretAlreadyRegistered } from "../scripts/circle-setup-errors";

const previousKey = process.env.CIRCLE_API_KEY;
const previousSecret = process.env.CIRCLE_ENTITY_SECRET;
afterEach(() => {
  if (previousKey === undefined) delete process.env.CIRCLE_API_KEY;
  else process.env.CIRCLE_API_KEY = previousKey;
  if (previousSecret === undefined) delete process.env.CIRCLE_ENTITY_SECRET;
  else process.env.CIRCLE_ENTITY_SECRET = previousSecret;
});

describe("Arc mainnet custody guards", () => {
  it("accepts only a complete LIVE key", () => {
    expect(circleKeyEnvironment("LIVE_API_KEY:id:secret")).toBe("live");
    expect(circleKeyEnvironment("TEST_API_KEY:id:secret")).toBe("test");
    expect(circleKeyEnvironment("LIVE_API_KEY:incomplete")).toBe("unknown");
    expect(circleKeyEnvironment("OTHER_API_KEY:id:secret")).toBe("unknown");
  });

  it("rejects test and malformed keys without exposing them", () => {
    process.env.CIRCLE_ENTITY_SECRET = "fixture-secret";
    process.env.CIRCLE_API_KEY = "TEST_API_KEY:id:secret";
    expect(platformCustody()).toBeNull();
    expect(custodyProblem()).toContain("TEST key");
    process.env.CIRCLE_API_KEY = "unexpected-sensitive-value";
    expect(platformCustody()).toBeNull();
    expect(custodyProblem()).not.toContain("unexpected-sensitive-value");
  });

  it("refuses historical testnet wallets even with live credentials", () => {
    process.env.CIRCLE_API_KEY = "LIVE_API_KEY:id:secret";
    process.env.CIRCLE_ENTITY_SECRET = "fixture-secret";
    const wallet = { provider: "circle_dcw", address: "0x1111111111111111111111111111111111111111", circleWalletId: "wallet-id", blockchain: "ARC", dataMode: "LIVE" };
    expect(signerFor(wallet)).not.toBeNull();
    expect(signerFor({ ...wallet, blockchain: "ARC-TESTNET" })).toBeNull();
    expect(signerFor({ ...wallet, dataMode: "TESTNET" })).toBeNull();
  });
});

describe("entity secret registration", () => {
  it("recognizes Circle's already-registered responses", () => {
    expect(entitySecretAlreadyRegistered({ response: { status: 409 } })).toBe(true);
    expect(entitySecretAlreadyRegistered({ response: { data: { code: 156015 } } })).toBe(true);
    expect(entitySecretAlreadyRegistered({ response: { data: { code: "156015" } } })).toBe(true);
    expect(entitySecretAlreadyRegistered({ response: { status: 401 } })).toBe(false);
  });
});
