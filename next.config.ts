import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Next.js App Router injects inline bootstrap scripts, so scripts/styles need 'unsafe-inline'
// ('unsafe-eval' only for dev tooling). The only third-party frame is Circle's Arc Onramp widget
// (src/components/features/wallet/onramp-button.tsx), per @circle-fin/onramp-kit's CSP notes.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://onramp.arc.io https://api.circle.com${isProd ? "" : " ws: wss:"}`,
  "frame-src https://onramp.arc.io",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
