# GrowTendril — Implementation Plan

## Audit

The repository was empty when work began (no commits, no files). This is a greenfield build.

The Circle/Arc documentation sites (`developers.circle.com`, `docs.arc.network`, `circle.com`) were blocked by
the build environment's network policy. Every Circle/Arc API used here was verified against the **published SDK
packages** on npm (READMEs and `.d.ts` type definitions) and the organizer's reference repo
(`the-canteen-dev/circle-agent`):

| Capability | Package / endpoint | Verified API |
| --- | --- | --- |
| x402 buyer | `@circle-fin/x402-batching/client` | `GatewayClient({chain:'arcTestnet', privateKey})`, `.deposit()`, `.pay(url)`, `.getBalances()`, `.getTransferById()`, `BatchEvmScheme(signer)` |
| x402 seller | `@circle-fin/x402-batching/server` | `createGatewayMiddleware({sellerAddress, networks, facilitatorUrl})`, `gateway.require('$0.01')` |
| Gateway API | `https://gateway-api-testnet.circle.com` | `POST /v1/balances`, `GET /v1/x402/transfers/:id` (status: received → batched → confirmed → completed / failed) |
| Agent Marketplace | `https://api.circle.com/v2/x402/discovery/resources` | keyless `GET ?query&category&limit&offset&siwx=false` (from `@circle-fin/cli` source) |
| Agent wallet | `@circle-fin/developer-controlled-wallets` | `signTypedData({walletId, data})`, `createTransaction(...)`, `getWalletTokenBalance` — keys custodied by Circle |
| App Kit | `@circle-fin/app-kit` | `kit.send`, `kit.bridge`, `kit.unifiedBalance.getBalances`, chain ids `Arc_Testnet`, `Base_Sepolia` |
| Adapters | `@circle-fin/adapter-circle-wallets`, `@circle-fin/adapter-viem-v2` | `createCircleWalletsAdapter({apiKey, entitySecret})`, `createViemAdapterFromPrivateKey` |
| Onramp | `@circle-fin/onramp-kit` | `createOnrampServerKit`, `createSessionRouteHandler` |
| Arc testnet | chain `eip155:5042002`, Gateway domain 26, USDC `0x3600…0000`, explorer `testnet.arcscan.app` | |

Earn Kit is marked "coming soon" in its own README → GrowTendril only *recommends* idle-fund placement, approval-gated, never executes it autonomously. Borrow is not built.

## Architecture

```
Next.js 15 (App Router, server components)      services/signals-api (Express, x402 seller)
   ├─ lib/intel      product analyst, discovery, narratives, KOLs, mentions (deterministic + optional Claude)
   ├─ lib/scoring    transparent weighted scores with per-component explanations
   ├─ lib/growth     opportunities, experiments, missions, budget, attribution, learning, brief, graph
   ├─ lib/agent      Zod action schemas → policy engine → state machine → receipts; operator loop
   ├─ lib/payments   signer (Circle DCW | server-only testnet key), x402 buyer, marketplace, App Kit, settlement tracker
   ├─ lib/providers  GitHub, Hacker News, Reddit (OAuth), YouTube, X (bearer), RSS, website; TikTok/Discord/Telegram = declared-unavailable
   └─ lib/db         Drizzle + Postgres (PGlite embedded by default, DATABASE_URL for a real server)
```

Money path: `LLM/heuristic → structured action (Zod) → policy engine (ALLOW/APPROVAL/DENY) → idempotent transaction
state machine → Circle (x402 Gateway / App Kit) → Arc → decision receipt`. Free-form text never reaches a payment call.

## Build order

P0 → onboarding, product profile, ICP, discovery + evidence, scoring, narratives, KOLs, missions, experiments,
operator, budget, policy engine, wallet, x402 purchase, receipts, attribution.
P1 → settlement tracing, App Kit send/bridge/unified balance, approval inbox, growth graph, daily brief.
P2 → onramp, Earn recommendation, extra providers.

## Honesty rules

Every record carries a `dataMode` (`DEMO`, `SIMULATED`, `TESTNET`, `LIVE`). Seeded rows say DEMO. Payment rows only
receive a settlement id / tx hash returned by Circle — when no wallet is configured the payment step is recorded as
`SIMULATED` with no hash, never a fabricated one.
