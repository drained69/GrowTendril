# GrowTendril — an autonomous growth operator that pays in USDC on Arc

**TL;DR.** GrowTendril is a full growth team for one website: it listens where your customers talk, shows you who is ready to buy, drafts first messages to the creators your customers already follow, proposes small experiments, and — when you say yes — pays creators and data sellers in **USDC on Arc mainnet**. Every payment is checked by a plain rules engine in code (not a prompt), limited to **10 USDC** per payment, verified against Arc as an independent witness, and left behind as a receipt you can inspect on-chain. Nothing moves without your approval.

Live at **[growtendril.xyz](https://growtendril.xyz)** · code at **[github.com/drained69/GrowTendril](https://github.com/drained69/GrowTendril)**

![Landing hero](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/01-landing-hero.png)

---

## The problem

Somewhere right now, someone is asking a public forum for exactly what you sell. Someone else is complaining about the competitor you beat. A creator your customers trust just posted about your category. **You will never see any of it** — there is too much, and it moves too fast. Growth, on paper, is a known loop: listen → test → spend → measure → do more of what worked. In practice it costs a human team weeks per month, and most teams don't have the team.

Founders don't need another dashboard. They need an operator that does the chores — one that is **honest about what it saw**, **honest about what it spent**, and **cannot pay the wrong person**.

That is what GrowTendril is.

---

## What it does, scene by scene

1. **Paste your website.** GrowTendril reads your public pages (robots.txt respected) and builds a profile: what you sell, who your customers are, what they search for, who your competitors look like.
2. **Listen.** It reads Reddit, Bluesky, Hacker News, YouTube, X and your RSS feeds through each platform's official or public API, scoring every post for intent, fit, recency and authenticity.
3. **Show.** The customers page lists real posts from people ready to buy, each one with its score breakdown and a link to where it was said.
4. **Shortlist creators** your customers already listen to — scored on what they publish, not on follower count. Automated accounts (bots, RSS feeds) are detected and capped so a vulnerability-feed bot doesn't score 100 on authenticity.
5. **Propose a small experiment** with a hypothesis, a tracked link, a budget, a timeframe and a stop condition.
6. **Draft the first message** to each creator; it never messages anyone on your behalf.
7. **When you approve a payment,** GrowTendril sends the agreed USDC on Arc to a named recipient, reads it back from the chain and stores the receipt alongside the experiment.
8. **Measure what converted.** The new **Customer value** view ties referred customers to confirmed (settled) spend, tells you cost per paying customer and payback, and recommends what to do next — only continue testing, improve the funnel, or stop spending.

![Customer value](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/11-app-customer-value.png)

The recommendation rules are deterministic (see `src/server/domain/growth/customer-value.ts`): small-sample → "continue testing"; low activation → "improve the funnel"; past the stop-after-spend threshold with no payers → "stop spending". No LLM decides whether to spend your money.

---

## Why Arc, specifically

GrowTendril is the kind of product Arc exists for: a stablecoin-native app that pays small amounts to many people, cheaply and verifiably, with no fiat rails to maintain. Every money path in the product runs on Arc mainnet:

### 1. **USDC is money.** No gas token.

Arc's native currency *is* USDC — the gas token and the thing you spend are the same asset. For founders this means they fund one wallet with one asset and the operator can run. For the product it means we can treat USDC as a unit of account end-to-end: every balance, invoice, budget, cap, receipt and ledger row is measured in micro-USDC. See `src/lib/money.ts` and `src/server/db/schema.ts` (the `micro` type).

### 2. **One USDC balance, two interfaces.** We read both.

Arc exposes USDC as both native value (18 decimals) and the ERC-20 contract at `ARC.usdc` (6 decimals). A native send never calls the ERC-20 contract, so it emits no ERC-20 `Transfer` event. **GrowTendril solves that by reading the system emitter** at `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`, which logs every USDC movement — native, ERC-20, mint, burn. It falls back to the ERC-20 log only when a receipt carries no system log. The real code lives in `src/server/domain/billing/arc.ts`:

```ts
// Arc's system emitter logs a Transfer (18 decimals) for every USDC movement:
// native sends, the native leg of ERC-20 transfers, mints and burns.
export const SYSTEM_EMITTER = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";
const NATIVE_PER_MICRO = 1_000_000_000_000n; // 18 − 6 decimals
```

This matters because without it you would silently miss native sends — the fast path a wallet uses by default — and reconciliation would be wrong by exactly the amount Arc is best at.

### 3. **The chain is the witness, not Circle.**

Circle reporting a transaction as sent is not proof. GrowTendril only marks a payment **SETTLED** after Arc shows the approved amount reaching the approved address, and nothing else leaving the wallet in that transaction. Anything else is held as `unverified` or opened as a reconciliation exception. See `src/server/domain/reconcile/wallet.ts`:

```ts
// Arc as the independent witness for an agent wallet.
//  confirmSend          — Arc shows the approved amount at the approved address.
//  reconcileWalletOutflows — every USDC transfer out of the wallet must match a recorded payment.
```

The chain-check status is stored per transaction (`chainCheck`: `verified | mismatch | unverified`) so you can see at a glance whether the ledger agrees with Arc.

### 4. **Billing is on-chain, exact-amount.**

Pay-per-service billing is paid in USDC on Arc. Each top-up is an invoice for an **exact** amount (the requested amount plus a few micro-USDC that identify the payment); the payer sends from a browser wallet (one click) or from any wallet. GrowTendril watches the billing address for the matching transfer and credits the balance. **No webhook, no payment processor, no card.** If someone rounds, pays after expiry, or pays twice, the reconciler opens a reviewable exception rather than silently sitting on the funds. See `src/server/domain/billing/arc.ts` + `src/server/domain/reconcile/billing.ts`.

![Billing on Arc](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/15-billing.png)

The browser pay flow (`src/components/features/billing/pay-invoice.tsx`) adds Arc to the user's wallet if missing (`wallet_addEthereumChain`), switches to it, and calls `eth_sendTransaction` with the USDC ERC-20 `transfer` calldata. The sender's own wallet signs it; GrowTendril never touches their keys.

### 5. **Wallets are Circle developer-controlled EOAs on Arc.**

Each workspace gets its own dedicated **Circle wallet-set EOA on Arc mainnet** (`src/server/integrations/circle/wallets.ts`). Private keys live in Circle's custody; the server holds only the Circle API key and entity secret, server-side. A workspace wallet created on another chain never signs on Arc — the custody guard refuses it (`custodyProblem()` in `src/server/integrations/circle/config.ts`) and the UI explains why.

![Wallet on Arc](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/12-app-wallet.png)

### 6. **Circle Gateway + x402 for data purchases.**

When the operator decides it's worth buying more intel on a company, it pays over **x402 through Circle Gateway**. We mirror `GatewayClient.pay()` but split it in two: `quote(url)` fetches the seller's terms (402 + `PAYMENT-REQUIRED`), the policy engine runs on the *quoted* price, and `pay(quote)` signs a `TransferWithAuthorization` (EIP-712) via `BatchEvmScheme`. The scheme's `onBeforePaymentCreation` hook enforces an absolute amount cap, so **a seller that changes its price between quote and payment cannot be paid more than was authorized.** See `src/server/integrations/circle/x402.ts`.

### 7. **The App Kit, used where it earns its place.**

Circle's App Kit is used for three things in GrowTendril: approved creator/bounty/partner **sends** (`appKitSend`), **bridging budget** to the chain a payment must land on (`appKitBridge`), and the **unified balance** that gives operators one chain-abstracted view of operating capital. See `src/server/integrations/circle/appkit.ts`.

---

## Your limits aren't suggestions. They're code.

![Spend policy](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/02-landing-rules.png)

The policy engine (`src/server/domain/agent/policy.ts`) runs on every payment proposal, in code, before anything is sent. It evaluates deterministic rules in order and emits an `ALLOW | APPROVAL_REQUIRED | DENY` verdict with a per-rule breakdown that lands on the Approvals page. Hard rules are enforced even against your own approval:

- **Hard ceiling: 10 USDC per payment** (`LAUNCH_CEILING_USDC` in `src/server/domain/workspace/setup.ts`). An override above this is blocked, not warned. This is the mainnet launch cap.
- **Daily cap** — rolls at UTC day start, resets automatically.
- **Mission budget** — the ceiling for a goal, enforced against committed + pending spend.
- **Named recipient only** — the operator cannot propose a payment without a recipient whose provenance is auditable (`src/server/domain/agent/payees.ts`).
- **Chain allowlist** — Arc mainnet for creator payouts; the policy engine refuses cross-chain transfers at mainnet launch, so funds stay on Arc.
- **Kill switch** — one toggle on the Wallet page freezes the wallet; every spend is then denied until a wallet manager resumes it.

Approval-level rules (daily/weekly caps, category caps, autonomous-amount caps) can be waived for one decision when you approve it, but **deny** rules (hard ceiling, mission budget, chain allowlist, kill switch) are re-checked at execution and still apply.

Everything is paired with a decision receipt — not an email summary, a stored row (`src/server/domain/agent/decisions.ts`, table `decision_receipts`) with the policy verdict, every rule's pass/fail, the inputs, the reasons, the on-chain hash and the explorer URL.

![Receipts](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/03-landing-receipts.png)

---

## How a full cycle looks under the hood

1. **Discover.** The operator schedules a cycle (manual, hourly, every 6h, or daily — each cycle = one priced market scan). Workers (`src/server/jobs/`) run signed reads against configured sources: Bluesky's open AppView, Reddit's public search feed (or official API where keys are present), Hacker News, YouTube, X, and RSS. Credentials are per-workspace and AES-256-GCM encrypted at rest (`src/server/security/secrets.ts`).
2. **Score.** Posts, companies and creators are scored by deterministic components (intent, fit, recency, engagement quality, authority, authenticity). Bots are detected (handle, display name, bio, cadence, link-only share) and capped at 25 on authenticity and 34 overall.
3. **Analyse.** The agent proposes experiments against a mission's goal, budget and stop condition.
4. **Policy.** The policy engine runs on every money action. ALLOW → execute. APPROVAL_REQUIRED → inbox. DENY → the operator cannot even propose it.
5. **Pay.** For creator payouts, the Circle wallet signs. For x402 data purchases, Gateway signs a `TransferWithAuthorization` through Batch EVM, capped by the quote.
6. **Verify on Arc.** `confirmSend` reads the receipt, finds the Transfer log (system emitter first, ERC-20 fallback), confirms the right address got exactly the approved amount. Only then does the transaction become `SETTLED`.
7. **Reconcile.** A separate job walks every USDC outflow from the agent wallet and matches it against recorded payments; anything else becomes an exception.
8. **Measure.** Customer value joins referred customers to confirmed spend and recommends the next action — deterministically, from the data.
9. **Notify.** If you've wired a Slack, Discord or signed JSON endpoint, the approval, payment, cycle and creator-post events fire with HMAC signatures and retries (`src/server/domain/notifications/webhooks.ts`).

---

## Pricing: pay for what runs, in USDC on Arc

![Pricing](https://raw.githubusercontent.com/drained69/GrowTendril/main/docs/dorahacks/04-landing-pricing.png)

- **Market scan — 2 USDC per scan.** One operator cycle: read sources, score, propose.
- **Influencer report — 3 USDC per refresh.** Scout new creators, read their profiles, rebuild the report with contact routes.
- **Campaign brief — 2 USDC per rewrite.** First draft per creator is free.

Browsing, settings, team, exports and the growth plan are free. Credit never expires. A service that fails is refunded automatically. Prices are code (`src/lib/services.ts`).

---

## Trust, by construction

- **AES-256-GCM** for provider credentials at rest, keyed by `ENCRYPTION_KEY`; secrets never leave the server.
- **HMAC-signed** inbound events webhook with a 5-minute replay window (`src/server/security/hmac.ts`); signed JSON notifications on the way out; both over HTTPS only.
- **SSRF guard** on every outbound HTTP call to a user-supplied URL (`src/server/security/public-http.ts`) — private, local and metadata addresses are blocked.
- **Idempotency** everywhere money moves — every transaction row carries an `idempotencyKey` and the policy engine refuses duplicate proposals.
- **Workspace isolation** — database rows are scoped by `project_id` and verified at every query boundary.
- **Reproducible builds + CI** — typecheck, 290 tests and a production build run on every push to `main`.
- **A read-only money-path doctor** — `npm run doctor` verifies the LIVE Circle key, the entity secret, Circle API access, Arc RPC and the current wallet's USDC/Gateway balance before you trust a deploy. It never moves funds.

---

## Stack

- **Chain:** Arc mainnet (chainId 1419, USDC-native). RPC `https://rpc.mainnet.arc.io`.
- **Custody:** Circle developer-controlled wallets, server-side.
- **Rails:** Circle App Kit (send/bridge/unified balance), Circle Gateway + x402 batching (data purchases), direct wallet payment flow for billing top-ups.
- **Reading Arc:** viem, system emitter + ERC-20, chunked `eth_getLogs` with cursor persistence.
- **App:** Next.js 15 (App Router, server actions), TypeScript strict, Drizzle ORM over Postgres (PGlite locally), Tailwind v4.
- **AI:** Gemini on free tier for launch (switchable to Claude via `LLM_PROVIDER=claude`). The LLM never decides whether to spend; it only drafts text and reads product sites.
- **Jobs:** durable in-process queue with backoff retries; a standalone worker is available for multi-instance deploys.
- **Email:** Resend. Google sign-in via OAuth 2.
- **Deploy:** Railway, one service, Postgres with persistent storage. CI (GitHub Actions) runs typecheck, tests and the production build.

---

## What is new in this submission

- **Customer value** — a transparent, deterministic view that ties referred customers to confirmed Arc spend and recommends the next move.
- **Hard mainnet guard** — TEST Circle keys are refused for mainnet operations; mis-chain wallets never sign.
- **Money-path doctor** — read-only checks of the full Circle/Arc path, including Gateway balance.
- **Outbound notifications** — Slack, Discord and signed-JSON webhooks for approvals, payments and cycles, over the job queue with retries and HMAC signatures.
- **Honest fictional examples** — every illustrative figure on the landing page respects the 10 USDC per-payment cap the code enforces.

---

## Try it in two minutes

1. Go to **[growtendril.xyz](https://growtendril.xyz)** and sign in (email code or Google).
2. Paste your website on the onboarding step. GrowTendril reads your public pages and fills in a profile.
3. Pick a mission template (e.g. "Find 20 Buyers") and a small budget. Hard caps are enforced regardless.
4. Open **Billing** and top up a few USDC on Arc (settles in about a second). Each market scan then costs 2 USDC.
5. Click **Run cycle** on the overview. Watch the agent log, open the customers it found, and read the scores back to their sources.
6. If and when it proposes a creator payment, approve it. Watch Arc confirm. Read the receipt.

Everything that happens is a row you can inspect, and a hash you can look up on an Arc explorer.
