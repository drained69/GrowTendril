import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only SDKs: keep them out of the bundler so their Node internals and WASM load untouched.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@circle-fin/developer-controlled-wallets",
    "@circle-fin/adapter-circle-wallets",
    "@circle-fin/app-kit",
    "@circle-fin/adapter-viem-v2",
    "@circle-fin/x402-batching",
    "@circle-fin/onramp-kit",
    "pg",
  ],
  poweredByHeader: false,
  // Lets a second dev server run beside the main one without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
