# GrowTendril

**Accountable growth operations for internet-native businesses.**

GrowTendril is an AI-assisted growth operator for local businesses, consumer products, online stores, B2B software, and developer tools. It helps teams understand their market, discover public demand signals, work with credible creators, run bounded experiments, and connect spending to customer outcomes.

It is built around a simple principle: growth activity should be measurable, spending should be controlled, and people should remain responsible for consequential decisions.

## The problem

Growth work is usually fragmented. Research lives in one tool, creator outreach in another, budgets in a spreadsheet, payments in a wallet, and conversion data somewhere else. That makes it difficult to answer the questions that matter:

- What is actually bringing in customers?
- Which creators are creating useful, measurable value?
- What did an experiment cost, and what did it return?
- What should the team repeat, change, or stop?

GrowTendril joins these parts into a traceable operating loop:

```text
Understand product → discover demand → qualify companies and creators → propose work
        → apply policy and approval → execute payment → attribute outcomes → learn
```

The product does not manufacture results or use seeded demo outcomes. Recommendations are grounded in configured sources, recorded inputs, or measured activity.

## Product capabilities

### Product and market intelligence

Start with a website and a short business description. GrowTendril reads public product pages and builds an editable profile covering the product, audience, positioning, market language, competitors, and location. That profile guides discovery instead of applying the same generic playbook to every business.

Site-based competitor intelligence uses comparison pages and public business-location evidence. The system does not add unverified competitor guesses simply to fill a list.

### Demand discovery

The operator searches connected public sources for relevant customer and company signals: product launches, hiring, recommendation requests, complaints, alternative comparisons, and category conversations. It can use Bluesky, Hacker News, Reddit, GitHub, YouTube, RSS, and X, subject to the credentials and access configured for the workspace.

Signals remain source-linked so a user can inspect why an opportunity was surfaced.

### Creator intelligence and campaigns

GrowTendril identifies creators already contributing to the right conversations. Its scoring gives weight to topic relevance, recency, discussion quality, audience fit, historical product fit, and authenticity. Follower count only modestly contributes to topic authority.

The authenticity model penalizes suspicious engagement patterns and caps automated feeds, bot accounts, highly regular link-only accounts, and accounts that identify themselves as automated. High posting volume alone cannot make an automated account look like a strong creator partner.

Creator campaigns support a clear brief, campaign objective, slots, budget, invitation flow, ownership proof, post submission, review, and rewards. Rewards can combine a base payment, a quality bonus for useful original work, and an outcome bonus for verified results.

### Guarded budgets and payments

Every payment proposal is evaluated by a deterministic policy engine. A workspace controls its budget, category allocations, daily spend, hard payment ceiling, and whether a person must approve an action before funds move. The current launch ceiling is **10 USDC per payment**. Cross-chain transfers are disabled.

On Arc mainnet, Circle developer-controlled wallets can send USDC and authorize Circle Gateway x402 payments. Payment decisions, approvals, state transitions, receipts, transaction hashes, and reconciliation exceptions are recorded for review.

### Measurement and customer value

Tracked links, signed conversion events, manually recorded conversions, attribution, payment receipts, and customer-value reporting connect work to outcomes. The customer-value view can show activation, purchase, repeat behavior, confirmed settled spend, and estimated payback when margin data is supplied.

Referral attribution identifies where a customer came from; it does not claim that an activity caused a purchase without sufficient evidence.

### Outbound notifications

Workspace admins can send outbound notifications to Slack, Discord, or a signed JSON webhook when an approval is requested, a payment settles or fails, an operator cycle finishes, or a creator submits work.

Endpoints are HTTPS-only, checked against the public-network guard, encrypted at rest, queued with retries, and signed with `x-growtendril-signature`. The notification interface lives in **Integrations** and requires the `manage_integrations` permission.

## Architecture

| Layer | Implementation |
| --- | --- |
| Web application | Next.js 15, React 19, TypeScript |
| Data layer | Drizzle ORM with Postgres in production and PGlite locally |
| AI and analysis | Gemini or Anthropic, with deterministic fallbacks where possible |
| Payments | Circle developer-controlled wallets, Arc mainnet USDC, Circle Gateway x402 |
| Background work | Durable database job queue with leasing, deduplication, and retries |
| Authentication | Email/password or Google OAuth, signed session cookies, verified email |
| Notifications | Slack, Discord, or HMAC-signed JSON webhook delivery |
| Deployment | Railway-compatible Node.js application |

## Security and operating principles

- Secrets remain server-side and are never prefixed with `NEXT_PUBLIC_`.
- Workspace provider credentials and outbound-webhook secrets are encrypted at rest with AES-256-GCM.
- User-supplied websites, feeds, and notification endpoints pass a public-network guard to block private IP ranges, localhost, embedded credentials, unsafe redirects, and DNS rebinding.
- Payment state changes are conditional and recorded in a transaction-event trail to reduce duplicate execution risk.
- Circle test API keys and non-Arc-mainnet wallets are rejected for mainnet signing.
- Circle entity-secret setup handles an already-registered secret safely and never prints secret material.
- The money-path doctor is read-only: it checks configuration and connectivity without creating wallets, transferring funds, or revealing credentials.
- Historical testnet wallet records are retained for receipts, but cannot sign Arc mainnet payments.

## Prerequisites

- Node.js 22 or newer
- npm
- A Circle developer-controlled-wallet account for live payment operations
- Postgres for production; PGlite is used automatically when `DATABASE_URL` is absent

## Quick start

```bash
npm ci
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and complete onboarding.

Without `DATABASE_URL`, GrowTendril stores local data in `.data/pglite`. The application applies Drizzle migrations on startup. `.env` is intended for deployable configuration; `.env.local` can override it for local-only settings.

### Safe local UI testing

Do not start an ordinary development server with production secrets to test payment, email, or integration flows. Start an isolated server with a throwaway database and blanked live credentials:

```bash
env NEXT_DIST_DIR=.next-audit \\
  PGLITE_DIR=/tmp/gt-audit-db \\
  DATABASE_URL= \\
  RESEND_API_KEY= EMAIL_FROM= \\
  CIRCLE_API_KEY= CIRCLE_ENTITY_SECRET= \\
  GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \\
  ONRAMP_API_KEY= BILLING_ARC_ADDRESS= \\
  BILLING_DEV=1 GROWTHOS_WORKER=off \\
  npx next dev -p 3100
```

When email is not configured locally, verification codes are written to the server console.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server on port 3000. |
| `npm run build` | Create a production build. |
| `npm run start` | Start the production server. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run the Vitest suite. |
| `npm run worker` | Start the standalone durable-job worker. |
| `npm run doctor` | Run read-only Circle and Arc money-path checks. |
| `npm run circle:entity-secret` | One-time Circle entity-secret registration. |
| `npm run env:push -- --dry-run` | Validate production configuration without uploading it. |
| `npm run env:push` | Upload configured environment values and redeploy through Railway. |
| `npm run ledger:exceptions` | List ledger records requiring reconciliation review. |
| `npm run signals` | Start the optional standalone paid data service. |

Before deployment, run:

```bash
npm run typecheck
npm test
NEXT_DIST_DIR=.next-build npx next build
```

CI runs dependency installation, typecheck, tests, and a production build for every push to `main`.

## Configuration

Copy `.env.example` to `.env` and configure only the services you intend to use. Never commit `.env`, `.env.local`, Circle recovery files, or private keys.

### Required in production

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Production Postgres connection string. |
| `APP_URL` | Public app URL, for example `https://growtendril.xyz`. |
| `SESSION_SECRET` | Secret used to sign sessions; use at least 32 characters. |
| `ENCRYPTION_KEY` | 32-byte AES key, encoded as 64 hex characters or base64. |

### Identity and communications

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM` | Verified email delivery for codes, receipts, reports, and invites. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth; set the callback to `<APP_URL>/api/auth/google/callback`. |
| `OPERATOR_EMAIL` | Inbox for unmatched billing-payment alerts. |

### Arc and Circle

| Variable | Purpose |
| --- | --- |
| `CIRCLE_API_KEY` | A complete production `LIVE_API_KEY` for Circle developer-controlled wallets. |
| `CIRCLE_ENTITY_SECRET` | The entity secret registered to that Circle account. |
| `BILLING_ARC_ADDRESS` | Arc address that receives user credit top-ups. |
| `ARC_MAINNET_RPC` | Optional Arc RPC override. |
| `GATEWAY_API_URL` | Optional Circle Gateway API override. |

### Intelligence providers

Set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` to enable AI-generated analysis and writing. `LLM_PROVIDER=claude` or `LLM_PROVIDER=gemini` selects a provider explicitly. Other optional integrations, including X, YouTube, Reddit, RSS, GitHub, and onramp support, are documented in `.env.example`.

### Development billing

Set `BILLING_DEV=1` only for local development and only when `BILLING_ARC_ADDRESS` is empty. It enables the local free-credit stand-in used to exercise paid-service flows.

## Accounts and access

People can create an account with email and password or Google OAuth. Email-password accounts must verify a six-digit code before using the product. Password resets use a time-limited code and invalidate other active sessions. Workspace access is role and permission based, including a dedicated `manage_integrations` permission for outbound notifications.

Production email delivery requires both `RESEND_API_KEY` and `EMAIL_FROM`. Without them, email-password sign-up is unavailable because verification cannot be completed.

## Mainnet setup

Live payments deserve an intentional setup process.

1. Back up the production database and confirm Circle entity-secret recovery material is stored safely outside the development machine and repository.
2. Set `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, and `ENCRYPTION_KEY` in the production environment.
3. Add a Circle production `LIVE_API_KEY` to `.env`, then run `npm run circle:entity-secret` once. Store recovery material outside the repository. If Circle reports an existing entity secret, recover and use the existing `CIRCLE_ENTITY_SECRET`; do not replace it with a new value.
4. Run `npm run env:push -- --dry-run`, then `npm run doctor`. Both are read-only validation steps.
5. Create a new workspace and create or attach a Circle developer-controlled **EOA** wallet on **Arc mainnet**.
6. Fund the wallet with Arc mainnet USDC. Deposit into Circle Gateway only when the workspace will use paid x402 services.
7. Connect market sources, set a mission and policy, and begin with small, founder-approved payments.

`npm run doctor` checks the Circle key environment, entity secret format, Circle API/public-key access, wallet-set access, Arc RPC availability, and—when a production database is configured—the latest active Arc wallet and Gateway balances. It never moves funds or prints secret values.

The app will not sign mainnet payments with a Circle test key, a malformed key, a non-Arc wallet, or a wallet whose Circle mode is not `LIVE`.

## Billing and paid services

GrowTendril uses prepaid USDC credit on Arc rather than a subscription. A workspace owner can top up credit, and paid services deduct from that balance only when the corresponding work runs. Failed paid-service attempts are refunded automatically.

The billing address is controlled by the operator. The application observes Arc transfers to confirm payments; it does not custody a user's top-up wallet.

| Service | Price | Includes |
| --- | --- | --- |
| Market scan | 2 USDC per scan | An operator cycle that reads sources, scores opportunities and creators, updates the growth plan, and proposes experiments. Each autopilot run is one scan. |
| Influencer report | 3 USDC per refresh | Creator scouting, profile review, contact routes, and initial outreach ideas. |
| Campaign brief | 2 USDC per rewrite | A refreshed brief for one creator; the first draft for each creator is free. |

Browsing, workspace settings, team management, and exports are free. Top-ups begin at 2 USDC. Autopilot waits when the workspace balance is too low instead of charging or executing a paid cycle.

## Health and deployment

`GET /api/health` reports non-sensitive configuration status for custody, email, billing, Google OAuth, and the selected AI provider. Use it after deployment to verify configuration without exposing credentials.

GrowTendril is designed for Railway, though it can run in any Node.js environment with persistent Postgres storage and environment variables. Before a production deployment, verify the working tree is clean, the full verification suite passes, migrations are additive, the database has been backed up, and the health endpoint and application logs are clean after release.

## Contributing

Issues and contributions are welcome. Keep changes focused, add or update meaningful tests, retain backward compatibility for live tracking links and integration headers, and do not include secrets, database dumps, or generated local data in commits.

## License

This repository is currently private and does not grant a public software license. Contact the project owner before reuse or redistribution.
