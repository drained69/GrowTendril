# GrowTendril — Architecture & Plan

This is the design record. The README is the user-facing guide; this file explains how the system is built and why.

## Audit basis

The Circle/Arc documentation sites were not reachable from the build environment, so every Circle/Arc API used here was
verified against the **published SDK packages** (READMEs and `.d.ts` types under `node_modules/@circle-fin/*`) and the
organizer's reference repo (`the-canteen-dev/circle-agent`). A full conformance review compared each call's method name,
parameter shape and response shape to the installed types and found no blocker-level mismatches.

| Capability | Package / endpoint | Verified API |
| --- | --- | --- |
| x402 buyer | `@circle-fin/x402-batching/client` | `GatewayClient({chain, privateKey})`, `.deposit()`, `BatchEvmScheme(signer)`, `CHAIN_CONFIGS` |
| x402 seller | `@circle-fin/x402-batching/server` | `createGatewayMiddleware({sellerAddress, networks, facilitatorUrl})`, `gateway.require('$0.01')` |
| Gateway API | `gateway-api-testnet.circle.com` / `gateway-api.circle.com` | `POST /v1/balances`, `GET /v1/x402/transfers/:id` (received → batched → confirmed → completed / failed) |
| Agent Marketplace | `api.circle.com/v2/x402/discovery/resources` | keyless `GET ?query&category&limit&siwx=false` (no SDK; the one call not type-verifiable) |
| Agent wallets | `@circle-fin/developer-controlled-wallets` | `createWalletSet`, `createWallets({accountType:"EOA"})`, `signTypedData`, `createContractExecutionTransaction`, `getTransaction`, `getPublicKey` |
| App Kit | `@circle-fin/app-kit` | `kit.send`, `kit.bridge`, `kit.unifiedBalance.getBalances`; chain ids `Arc`/`Arc_Testnet`, `Base`/`Base_Sepolia`, … |
| Adapters | `@circle-fin/adapter-circle-wallets`, `@circle-fin/adapter-viem-v2` | `createCircleWalletsAdapter`, `createViemAdapterFromPrivateKey` |
| Onramp | `@circle-fin/onramp-kit` | `createOnrampServerKit`, `createSessionRouteHandler` |

Networks (selected by `GROWTHOS_NETWORK`, all values from `CHAIN_CONFIGS` and viem's registry):

| | Testnet (default) | Mainnet |
| --- | --- | --- |
| Arc chain id | 5042002 | 5042 |
| Gateway domain | 26 | 26 |
| Gateway API | gateway-api-testnet.circle.com | gateway-api.circle.com |
| Circle Wallets blockchain | `ARC-TESTNET` | `ARC` |

Earn Kit is "coming soon" in its own README, so GrowTendril only *recommends* idle-fund placement and never executes it. Borrow is not built.

## Source layout

```
src/app/                       routes only: (marketing), (auth), invite, onboarding, app/*, c/[token] + creator/[token] (public), api/*
src/components/{ui,layout,features,charts}   design system, app shell, feature components
src/lib/                       isomorphic helpers (money, time, shell types)
src/server/
  actions/                     server actions, one module per area; every one starts with guard(permission)
  auth/                        sessions, passwords, roles & permissions
  domain/{agent,intel,scoring,growth,workspace}
  integrations/{circle,providers,llm,vault.ts}
  jobs/                        durable queue, scheduler (autopilot), handlers, worker
  queries/                     read models for pages
  security/                    HMAC, rate limits, AES-256-GCM secrets, SSRF-safe fetch
  db/                          Drizzle schema (47 tables), PGlite/Postgres client, helpers
  demo/                        seed, guided script, fixtures
services/signals-api/          x402 seller (Express)
scripts/                       seed, demo-run, doctor, wallet-setup, worker, test-events
```

## Core flows

**Money path.** `heuristic or LLM → structured action (Zod) → policy engine (ALLOW / APPROVAL / DENY) → idempotent
transaction state machine → Circle (x402 Gateway or App Kit) → Arc → sha256-sealed decision receipt`. Free-form text never
reaches a payment call. Approval re-runs the deny rules. Idempotency keys cover repeats; `payoutRef` distinguishes
intentional repeat payments (second tranche, creator payouts).

**Multi-tenancy.** Workspaces with owner / admin / member / viewer roles, hashed single-use invite tokens, per-workspace
encrypted provider credentials, and one Circle wallet per workspace. Permissions are enforced in every action and page.

**Jobs.** A Postgres-backed queue (`FOR UPDATE SKIP LOCKED`, leases, backoff, dedupe keys) runs operator cycles
(may spend within policy), discovery-only scans (never spend), settlement polling, Gateway deposits and cleanup.

**Creator campaigns.** Business sets the target action, max cost per action and a test budget; the planner derives
creators, ceilings and pay from those and the project's own Economics settings. Only a test phase is released at
launch; the held remainder goes only to creators whose measured cost per action beats the ceiling. Verified actions
sit in a holdback period before they are payable. Payouts are standard `send_payment` actions through the policy engine.

## Mainnet safety

Development keys are refused; new wallets start frozen and only an owner may resume spending; the default policy keeps
every category but paid research behind approval; chains outside the deployment's network are denied; a balance rule
checks Gateway (x402) or wallet (send) funds before committing; payouts to missing or burn addresses are denied.

## Honesty rules

Every record carries a `dataMode` (`DEMO`, `SIMULATED`, `TESTNET`, `LIVE`). Seeded rows say DEMO. Payment rows only
receive a settlement id or tx hash that Circle returned; with no wallet the step is recorded as `SIMULATED` with no
hash. Campaign and economics figures are labelled by source (measured, setting, starting value) and missing inputs stay
missing. The doctor reports a blocked host as a failure and never fabricates a result.

## Verification

CI (`.github/workflows/ci.yml`) runs typecheck, the unit tests (policy, scoring, learning, security, workspace, jobs,
x402 round-trip, campaigns), a production build and an offline run of the 8-step agent loop in simulation; the
typecheck and tests run again under `GROWTHOS_NETWORK=mainnet`. A browser pass over every page was done by hand against a
production build. The live Circle/Arc paths are validated by `npm run doctor` on a networked machine; they have not
been run live from the build environment, whose network policy blocks those hosts.
