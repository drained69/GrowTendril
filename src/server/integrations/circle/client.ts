import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

/** Server-side Circle Wallets client (developer-controlled). Credentials never leave the server. */
let client: Promise<CircleDeveloperControlledWalletsClient> | null = null;

export function circleClient(): Promise<CircleDeveloperControlledWalletsClient> {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) throw new Error("Circle is not configured on this deployment (CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET)");
  if (process.env.CIRCLE_API_KEY.startsWith("TEST_API_KEY:")) throw new Error("An Arc mainnet wallet requires a Circle production API key");
  client ??= import("@circle-fin/developer-controlled-wallets").then((m) =>
    m.initiateDeveloperControlledWalletsClient({ apiKey: process.env.CIRCLE_API_KEY!, entitySecret: process.env.CIRCLE_ENTITY_SECRET! }),
  );
  return client;
}
