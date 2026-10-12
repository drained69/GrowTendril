# GrowTendril

GrowTendril is a growth operator for any product: a local business, a consumer app, an online shop, B2B software, or a developer tool. A founder sets a customer outcome, budget, product profile, and ideal customer. The operator gathers source-linked market signals, identifies qualified companies and creators, proposes bounded experiments, requests approval for each payment, and records attribution and decisions in a traceable loop.

## Current product

- **Discover:** read connected public sources and score intent, fit, narratives, creator relevance, and product friction. Bluesky, Hacker News, Reddit (its public search feed, about one search a minute) and GitHub (developer products only) work without keys; YouTube (free Google Cloud key), RSS feeds and X use what you add. X reads are pay-per-use, so leave `X_BEARER_TOKEN` empty unless that X account has credits. Reddit approves new API apps by request; approved keys add vote counts and higher limits.
- **Plan:** create an experiment with a hypothesis, target, budget, timeframe, and stop condition.
- **Approve:** every Arc mainnet payment goes through a deterministic policy engine and a founder approval. The launch hard ceiling is 10 USDC per payment. Cross-chain transfers are disabled.
- **Pay:** Circle developer-controlled wallets send Arc USDC or sign Circle Gateway x402 payments. A wallet and real payment quote are required; there is no simulated-payment fallback.
- **Learn:** tracked links, signed conversion events (or conversions recorded by hand on each experiment), receipts, and transaction states connect spend to a measured outcome.
- **Customer value:** per campaign, which referred customers activate, pay and return, against confirmed (settled) spend. Send your own stable customer ID as `visitorId` and `value` on purchases. Gross profit and payback are labelled estimates from an optional margin; referral shows where a customer came from, not that the campaign caused the sale.

The website presents product capabilities without seeded or fictional results. No demo workspace or guest entry point is available.

## Run locally

Node 22 or newer and npm are required.

```bash
npm ci
cp .env.example .env
npm run dev
```

Keep keys in `.env`: it is what `npm run env:push` uploads. Next.js lets `.env.local` override `.env`, including with empty values, so only put local-only switches there (such as `BILLING_DEV=1`).

With no `DATABASE_URL`, local development uses PGlite in `.data/pglite`. Production should use Postgres with persistent storage. The app applies Drizzle migrations on startup. Run `npm run typecheck`, `npm test`, and `npm run build` before deployment.

## Accounts, email and billing

- **Sign up:** with Google ("Continue with Google") or email and password. Email sign-ups get a 6-digit code (10 minutes, 5 attempts) and can't use anything until they enter it. Forgotten passwords are reset with an emailed code, which also signs out every other session.
- **Prepaid credit in USDC on Arc:** no subscription. The account that owns a workspace tops up any amount (from 2 USDC) and each service takes its fixed price from that balance when it runs — a market scan (2 USDC, including every autopilot run), an influencer report refresh (3 USDC) or a campaign brief rewrite (2 USDC). Prices live in `src/lib/services.ts`. Browsing, the growth plan, settings, team and exports are free, and a service that fails is refunded automatically. A top-up is an invoice for an exact amount (the requested amount plus a few micro-USDC that identify the payment); the payer sends it from a browser wallet with one click or from any wallet, and GrowTendril confirms it on Arc — by watching USDC transfers to the billing address or by checking a pasted transaction hash — then credits everything that arrived. Each transaction pays once and must be newer than the invoice. Autopilot waits, rather than failing, while the balance is too low.
- **Email:** codes, welcome, plan active / payment failed / plan ended, invites and on-demand reports (influencer report, growth plan) go to each person's verified address. Every send is logged and listed under **Settings → Account & billing**.

Production setup (all in `.env`, uploaded with `npm run env:push`):

1. **Email** — create a [Resend](https://resend.com) account, verify your sending domain, then set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `GrowTendril <hello@growtendril.xyz>`). Without these, new sign-ups are refused in production because nobody could receive their code.
2. **Google** — in Google Cloud Console create an OAuth client (Web application) with the redirect URI `<APP_URL>/api/auth/google/callback`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The Google button appears once both are set.
3. **Billing address** — set `BILLING_ARC_ADDRESS` to an Arc wallet you control (your Circle wallet or any EVM wallet); top-ups go straight there. Services start charging as soon as the address is set; until then every service is free. No webhook or payment processor is involved: payments are read from Arc mainnet over `ARC_MAINNET_RPC`.

4. **AI writing** — set `GEMINI_API_KEY` (free tier at aistudio.google.com/apikey; defaults to the flash-lite models, which stay responsive on the free tier) or `ANTHROPIC_API_KEY` for Claude. Gemini wins while its key is set; `LLM_PROVIDER=claude` forces Claude. For Claude: A key created inside a Console workspace works as is; a key that isn't scoped to a workspace (`sk-ant-usr-…`) also needs `ANTHROPIC_WORKSPACE_ID`.

`npm run env:push -- --dry-run` checks these against the live services (AI key, Google redirect URI, email pair, Circle access) before anything is uploaded. `/api/health` reports `ai` (`gemini`, `claude` or `false`), `email`, `google` and `billing` (`arc`, `off`) so you can confirm each one is live. For local development, `BILLING_DEV=1` in `.env.local` turns charging on with a free "Add credit" stand-in (only when no billing address is set), and codes are printed in the server console when email isn't configured.

## Mainnet setup

1. Add `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, and `ENCRYPTION_KEY` in the production service.
2. Put a production `CIRCLE_API_KEY` in `.env` (gitignored), run `npm run circle:entity-secret` once to register an entity secret (the recovery file goes to `~/.growtendril/circle-recovery`), then run `npm run env:push` to upload non-empty values to Railway and redeploy. The API key must belong to the Circle account that manages the wallets. Keep the entity secret and recovery material outside the repository.
3. Create a new workspace and use **Wallet → Create wallet on Arc mainnet**, or attach a Circle developer-controlled EOA on Arc mainnet.
4. Fund that wallet with Arc mainnet USDC. Deposit USDC into Circle Gateway only when you intend to use paid x402 services.
5. Connect actual market sources, set a mission and budget, and run a cycle. Review each payment in **Approvals** before any funds move.

Existing Arc testnet wallets are not converted or reused. Create a new workspace for mainnet. The application retains historical testnet transaction metadata so old receipts can still link to the correct explorer.

Circle credentials are currently required for live wallet operations. Without them, discovery and planning can run, while payment proposals remain disabled by policy.

## Important limits

A seller must present a fresh Circle Gateway x402 quote on Arc mainnet for USDC before GrowTendril can propose a purchase. The approved recipient and price are checked again before payment. Creator payments require an explicit EVM payout address. A configured data provider and a funded wallet are necessary for a real end-to-end paid cycle. Mainnet transactions have not been automatically generated by this repository.

The standalone `npm run signals` service is optional and is not registered in the operator's marketplace by default. It requires its own Arc mainnet seller address and deployment.
