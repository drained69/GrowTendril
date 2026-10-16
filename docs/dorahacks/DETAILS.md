# GrowTendril — an evidence-led growth operator with USDC payments on Arc

GrowTendril helps a small business move from a website to a measurable growth experiment. It reads permitted public sources, surfaces customer conversations and relevant creators, proposes a bounded test, records what the business approved, and reconciles payments and customer outcomes. The product is a working application. Its Apache-2.0-licensed Arc toolkit is being prepared for a **separate public repository** so builders can fork the primitives without taking the application. A creator-reward escrow is deployed on Arc mainnet, but live creator payouts have **not** been routed through that escrow.

**Product:** [growtendril.xyz](https://growtendril.xyz) · **Public toolkit repository:** publication pending · **Mainnet contract:** [OutcomeRewardsEscrow](https://explorer.arc.io/address/0x2964e74d30413de186f5f4936eb133ab815845d3) · **Source verification:** [Sourcify exact match](https://repo.sourcify.dev/5042/0x2964E74d30413DE186f5F4936Eb133Ab815845D3)

**Arc mainnet contract address (chain ID 5042):** `0x2964e74d30413de186f5f4936eb133ab815845d3`

![GrowTendril landing page](https://growtendril.xyz/dorahacks/01-landing-hero.png)

## The problem and the product

A potential customer asks about your category in a public forum. A creator your audience trusts discusses the same problem. A competitor's customer complains about a gap you could fill. Small teams rarely have time to find these signals, test a response, follow up with creators, and measure whether any spending helped.

GrowTendril connects those tasks in one workspace:

**Understand the business → collect source-linked evidence → choose a small experiment → review spending → observe customer events → reconcile the result.**

It is an operator with review points, not a guarantee of customers or an automatic outreach bot. Scores and drafts help a human decide what to do. The application does not send unsolicited messages or promise that a referred purchase was caused by a campaign.

## The journey, scene by scene

1. **Start with a website or a description.** A visitor can enter a public website on the landing page or describe the business. The website is carried through sign-in into onboarding. Public page fetching respects robots.txt; manual context remains possible when a website is unavailable. Entering a URL does not itself create a workspace or incur a scan charge. See website entry (src/components/marketing/website-start.tsx) and onboarding routing (`src/server/auth/next-step.ts`).
2. **Set a goal and sources.** The workspace records its audience, product, mission, budget, permitted providers and scan cadence. Owners can connect source credentials; availability depends on the provider and the workspace's configuration. The initial discovery journey does not require a funded payout wallet.
3. **Find evidence.** A scan reads available public or authorized sources such as Reddit, Bluesky, Hacker News, YouTube, X and RSS feeds. It stores source references and scores intent, fit, recency and authenticity. A result is a lead to investigate, not a verified purchase intent or contact address.
4. **Review customers and creators.** B2B company opportunities and individual public conversations appear with context and a link to the original source when available. Creators are evaluated for topical fit, activity, engagement quality and authenticity rather than follower count alone. Automated feeds and bot-like accounts receive capped authenticity scores.
5. **Choose the next action.** Overview recommends one useful step based on workspace state: finish setup, inspect an active run, review an opportunity, handle an approval, add service credit or examine missing source coverage. Opportunity cards explain their rationale, proposed action, priority, confidence and known or unknown cost. They do not create a campaign or authorize payment.
6. **Plan a bounded test.** Missions define goals and budgets. Experiments define a hypothesis, success event, tracked link, time frame and stop condition. A creator campaign adds a brief, slots, reward terms, evidence and a review process. The app drafts first messages; the business chooses whether to send them.
7. **Apply payment policy.** A proposed money action is parsed into a structured action and evaluated by deterministic code. It becomes denied, awaits approval or is authorized. A person-to-person creator, bounty or partner payment requires a matching founder approval; bounded research purchases may be autonomous only when the owner explicitly enables that policy.
8. **Settle on the appropriate Arc rail.** The current creator payout path uses a Circle-controlled workspace wallet and App Kit send. Paid data requests use Circle Gateway's x402 terms. Billing top-ups are direct USDC transfers to the configured billing address. Each has a different settlement contract or wallet path; a custom GrowTendril contract is not required for every on-chain transaction.
9. **Check the result.** Direct sends are read back from Arc and compared with the approved recipient and amount. Mismatches and unexplained wallet outflows become exceptions. Gateway acceptance and later batch settlement remain distinct states. Receipts retain the decision, policy checks and available chain evidence.
10. **Measure what followed.** First-party signup and purchase events, merchant commerce events where connected, refunds and referral links feed Customer value. It distinguishes recorded revenue, estimated profit based on an entered margin, confirmed versus pending costs, and small samples. Recommendations come from rules, not an LLM decision to spend.

![Customer value screen](https://growtendril.xyz/dorahacks/11-app-customer-value.png)

*Interface illustration from a test workspace; the displayed customer and credit values are not production customer outcomes.*

## What each product area is for

| Area                                        | Operator decision or evidence                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Overview and Daily brief                    | What needs attention now, what changed, and the next useful action.                                            |
| Discover and Narratives                     | Source-linked market signals and recurring language, with coverage dependent on connected sources.             |
| Customers and Opportunities                 | Companies or individual public conversations, score explanations, original posts and reviewable proposals.     |
| Creators and Influencer report              | Creator fit, a report, contact routes when known, and draft outreach for human review.                         |
| Growth graph and Growth plan                | Relationships between evidence, audience, creators, goals and planned actions.                                 |
| Missions and Experiments                    | Goal, budget, hypothesis, success event, time frame and stop rule.                                             |
| Creator campaigns                           | Published reward terms, participant verification, submitted posts, qualified outcomes and final reward review. |
| Customer value                              | Referred cohorts, purchases, matching refunds, net recorded revenue, confirmed spend and payback estimates.    |
| Wallet, Approvals, Activity and Receipts    | Operating funds, exact payment decisions, Circle/Arc settlement state and auditable evidence.                  |
| Agent runs, Integrations, Team and Settings | Execution history, provider and merchant connections, permissions, business context and spending policy.       |

The sidebar keeps the common daily actions visible and places additional views in expandable groups. All routes remain available. See navigation (`src/components/layout/nav-config.ts`) and the product review (docs/PRODUCT_REVIEW_ORIGAMI.md).

## Why Arc is part of the design

[Arc mainnet](https://docs.arc.io/arc/references/rpc-endpoints) uses chain ID 5042 and USDC as its native gas asset. A workspace can use USDC for fees and payments without acquiring a separate gas token. Arc exposes the same underlying USDC balance through native value with 18 decimals and an [ERC-20 interface](https://docs.arc.io/arc/concepts/stablecoin-native-model) at 0x3600000000000000000000000000000000000000 with 6 decimals. GrowTendril's business amounts use integer micro-USDC; native gas and native transfer values must be converted separately.

Arc's [system emitter](https://docs.arc.io/arc/concepts/stablecoin-native-model) logs USDC sends, ERC-20 transfers, mints and burns in 18-decimal units. An ERC-20 transfer also emits its 6-decimal token log. The Arc reader (`src/server/domain/billing/arc.ts`) uses the system event for a complete movement view and avoids counting both logs as two payments. It checks the transaction receipt and the actual address and amount before treating a direct payout as verified. Gas deductions do not appear as transfer events.

A chain transaction is still possible without a new GrowTendril contract. Existing [Arc USDC, Gateway and CCTP contracts](https://docs.arc.io/arc/references/contract-addresses) already provide the token, paid-request and cross-chain primitives. A custom contract is useful when GrowTendril needs its own enforceable custody rule, such as holding a creator reward until a review and refund window closes.

### Current payment routes

| Flow                               | Current mechanism                                                              | What GrowTendril checks                                                                        | Relationship to our escrow                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Creator, bounty and partner payout | Founder-approved Circle wallet/App Kit USDC send on Arc mainnet                | Policy, approved recipient and amount, Arc receipt, unexpected outflows                        | Mainnet escrow exists but production payouts have not switched to it.             |
| Paid data purchase                 | Circle Gateway x402, using the seller's Arc Gateway terms                      | Quoted asset, network, contract, recipient and price; authorization limit; eventual settlement | A seller's Gateway verifying contract cannot be replaced with our creator escrow. |
| Merchant sale                      | Merchant's configured AuthCaptureEscrow contract, if connected                 | Successful Arc receipt and decoded contract log; capture/refund lifecycle                      | Merchant funds stay in the merchant's contract. GrowTendril consumes evidence.    |
| Billing top-up                     | User-signed USDC transfer to the configured billing address                    | Exact invoice amount, recipient, transaction and replay protection                             | No custom billing receiver is deployed.                                           |
| Wallet funding and withdrawal      | Circle wallet and Arc USDC transfer                                            | Custody/network checks, owner authorization, destination and Arc evidence                      | No GrowTendril treasury vault is deployed.                                        |
| Cross-chain bridge                 | App Kit implementation exists, but launch payment policy denies bridge actions | Mainnet policy rejects the action before execution                                             | The creator escrow is not a bridge.                                               |

The account's **prepaid service credit** and its **operating wallet USDC** are separate balances. To fund scans, the user sends USDC from their own wallet to the Arc billing address shown on an invoice (`BILLING_ARC_ADDRESS`). After GrowTendril confirms that transfer, it credits the workspace owner's prepaid account. Each completed market scan deducts **2 USDC of credit in the application ledger**; running the scan does not send another on-chain transfer to any wallet or to the creator escrow. If a charged scan fails, its charge is refunded as credit. The separate Circle workspace wallet is for external purchases and founder-approved payouts to named recipients. Thus a credit-ledger entry is not itself an on-chain transfer.

### Billing on Arc

With BILLING_ARC_ADDRESS configured, a top-up creates a two-hour invoice for the requested amount plus a small unique micro-USDC suffix. The browser can prepare an ERC-20 transfer in the payer's own wallet; GrowTendril does not hold that wallet's key. The app checks the transfer on Arc, credits the amount received once, and records a receipt. Late, rounded, duplicate or unmatched payments go to a reviewable exception path. If billing is not configured, the deployment's billing mode can be off; development mode also exists for local testing. See billing (`src/server/domain/billing/index.ts`), Arc transfer reader (`src/server/domain/billing/arc.ts`) and billing reconciliation (`src/server/domain/reconcile/billing.ts`).

![Arc billing screen](https://growtendril.xyz/dorahacks/15-billing.png)

*Interface illustration from a test workspace; the displayed balance and spending are not a live customer's funds.*

### Circle wallets and Gateway

A live workspace wallet is a Circle developer-controlled Arc EOA. The server uses Circle credentials and an entity secret; the application never gives the creator or customer that wallet's private key. A TEST or malformed Circle API key is rejected for mainnet custody. See wallet integration (`src/server/integrations/circle/wallets.ts`) and chain configuration (`src/server/integrations/circle/config.ts`).

For x402 research, GrowTendril first requests the seller's payment terms. It accepts only the expected Arc USDC/Gateway option, runs policy against the quoted price, then creates a capped EIP-712 authorization. A seller cannot increase the amount beyond the approved maximum during payment creation. Gateway may accept the authorization before an on-chain batch settles, so the UI and ledger must not call that initial acceptance a confirmed individual on-chain payment. See x402 integration (`src/server/integrations/circle/x402.ts`) and settlement execution (`src/server/domain/agent/execute.ts`).

![Operating wallet](https://growtendril.xyz/dorahacks/12-app-wallet.png)

*Wallet interface illustration; use an Arc explorer receipt to substantiate any live payment claim.*

## Spending rules and accountability

The policy evaluator (`src/server/domain/agent/policy.ts`) returns ALLOW, APPROVAL_REQUIRED or DENY with a result for each rule. The default per-payment ceiling is **10 USDC**, and an owner can explicitly configure another ceiling. Deny-level rules such as the effective ceiling, mission budget, allowed chain and token, forbidden actions and wallet freeze cannot be waived by approving a request. Approval-level rules can be satisfied by a founder's approval of the exact decision. Autonomous spending starts off; when enabled, it is restricted to configured categories, transaction limits, daily limits and approved services. Payments to people still require approval.

The ledger (`src/server/domain/agent/ledger.ts`) reserves committed spend, rechecks current rules before signing, and uses a conditional EXECUTING transition so concurrent workers cannot claim the same authorization. The creator reward guard (`src/server/domain/growth/creator-reward-guard.ts`) also rechecks the accepted post, verified recipient, published amount, current eligible outcomes and previous payout attempts. A mismatch cannot be presented as a successful approved payout.

Decision receipts record policy inputs, checks, approval and transaction evidence. Portable receipts (src/server/domain/agent/portable-receipts.ts) can carry an Ed25519 issuer signature when ARC_RECEIPT_SIGNING_KEY is configured; without that key, a digest alone does not authenticate who issued the receipt. See the receipt verifier (scripts/verify-arc-receipt.ts).

![Spending rules](https://growtendril.xyz/dorahacks/02-landing-rules.png)
![Decision receipts](https://growtendril.xyz/dorahacks/03-landing-receipts.png)

## Creator campaigns, outcomes and refunds

A live creator campaign publishes terms for a 14-day experiment: number of slots, base reward, quality bonus, outcome bonus and cap. A creator accepts those terms and submits a post. The business verifies the participant and payout address, reviews the post against its rubric, and completes final reward review after the campaign window. The proposed reward is recalculated immediately before payment. A confirmed customer purchase is eligible only under the campaign's attribution and timing rules; matching refunds reduce net purchase value and can remove pending outcome bonuses. Neither a public post nor a referral click alone proves revenue.

The optional merchant commerce connector provides stronger purchase evidence. An authorized merchant sends an order identifier, customer/referral association and transaction-log pointers. GrowTendril reads the pinned Arc network and merchant contract itself, requires a successful canonical receipt, decodes the payment event, and replays authorization, capture, charge, void and refund events idempotently. An authorization alone does not count as captured revenue. Order/customer/referral identity cannot change after registration. The chain proves a payment event; the merchant still attests which customer and referral belong to the order. The connector supports Arc testnet and mainnet configurations, but requires a real merchant contract and event feed before it produces live outcomes. See commerce connector (src/server/domain/growth/commerce.ts) and integrations (`src/app/app/integrations/page.tsx`).

Customer value applies matching refunds to recorded purchases, keeps unknown values visible, and bases cost-per-paying-customer and payback calculations on confirmed spend. Margin-based profit and payback remain estimates, and referral attribution is not proof of causal lift. See customer value (`src/server/domain/growth/customer-value.ts`).

## The deployed creator escrow

**OutcomeRewardsEscrow mainnet address:** `0x2964e74d30413de186f5f4936eb133ab815845d3`

**One GrowTendril contract has been deployed twice:** [Arc testnet](https://explorer.testnet.arc.io/address/0x2371d0f4a064d1eb5f154dd99d355a7f4fa71aa3) and [Arc mainnet](https://explorer.arc.io/address/0x2964e74d30413de186f5f4936eb133ab815845d3). The mainnet deployment transaction is [0x29d876…34a822](https://explorer.arc.io/tx/0x29d876d0d5ee161897959252af559a380fbb6511a409160edabe7b5b9134a822). Sourcify reported an exact creation-bytecode and runtime-bytecode match for the [mainnet source](https://sourcify.dev/server/v2/verify/1c6ed23a-11ff-4440-a102-76dc05608be6). Arc's explorer API blocked source publication with a Cloudflare challenge, so its own Contract tab may not yet display verified source. The deployment manifest (contracts/deployments/arc-mainnet.json) records the chain, address, constructor, source hash and verification status.

OutcomeRewardsEscrow.sol (contracts/src/OutcomeRewardsEscrow.sol) is a prefunded, USDC-only reward pool. Each campaign fixes an owner, independent arbiter, deadline, maximum budget, reward formula, slot count and terms hash. The reward formula is base + quality bonus scaled from 0–100 + outcome bonus times eligible outcomes, within the campaign's cap. The owner can queue at most one reward per recipient after the campaign deadline and within a seven-day review window. A queued reward waits **72 hours** before claim. Before that hold ends, a qualifying refund can reduce its outcome bonus; owner or recipient can dispute, and the arbiter resolves release or rejection. Anyone can relay an eligible claim, but payment goes to the bound recipient. Unused, unreserved funds can be returned after the review window. The contract cannot itself determine whether a post was good or a customer event was genuine; those are business attestations supplied before queueing.

The campaign escrow controls currently in the app connect **only to Arc testnet**. The mainnet contract was deployed and source-matched, but it was not funded or wired into live creator payouts at deployment. It has not received an independent security audit. The deployment and routing runbook (docs/ARC_DEPLOYMENT_RUNBOOK.md) tracks the remaining security review, testnet end-to-end exercise, production integration and reconciliation steps. Source verification is evidence that published source matches bytecode; it is not a security audit or a claim that every GrowTendril transaction flows through this contract.

## Composable tools for other Arc builders

The `@growtendril/arc-growth-tools` package extracts parts of the workflow so an affiliate, marketplace, bounty or agent-payment app can use them without GrowTendril's UI, database or AI. It is **Apache-2.0 licensed and independently buildable**, with its own tests and integration guide. The public repository has not yet been published, and the package is not on npm. Its independent example imports the package **by name**, runs a fixture-only outcome flow, and includes a read-only checker for a real Arc mainnet ERC-20 USDC transfer. That checker requires an actual transaction hash and expected parties; it does not create or claim a live merchant sale or creator payout.

| Module                              | Reusable job                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Commerce events                     | Normalize and replay contract events with chain, payment, transaction and log identity; calculate captured and refunded order state. |
| Outcomes and rewards                | Apply a refund hold, calculate net purchases and capped creator rewards.                                                             |
| Spending policy                     | Evaluate a typed intent, reserve against concurrent spend, bind approval to exact terms and reconcile ambiguous execution.           |
| Arc payment evidence                | Check chain, token, sender, recipient and amount against an observed transfer.                                                       |
| Portable receipts                   | Canonicalize evidence, sign with a configured issuer key and verify with an independently trusted public key.                        |
| Recipient proof and escrow bindings | Bind a creator address to an invitation with a signed challenge; expose the escrow ABI and a deployed-code matcher.                  |

The package includes event definitions needed to interoperate with Circle's commerce example, with third-party attribution in its notices. The contribution is the composable **outcome-to-payout flow**: verified merchant payment → attributed and refund-aware customer outcome → bounded reward → policy and approval → Arc payout evidence. [Arc Commerce](https://github.com/circlefin/arc-commerce) already demonstrates USDC credit purchases, and [Arc P2P Payments](https://github.com/circlefin/arc-p2p-payments) already demonstrates wallet-to-wallet payments. GrowTendril adds the reusable business logic between an observed sale and a controlled reward: replay-safe captures and refunds, a refund hold, bounded reward math, serializable spend reservations, exact-intent approval and independently checked receipts. It does not replace Circle's wallet, Gateway or bridge protocols.

**How another builder starts:** clone the standalone toolkit repository once published, run `npm install && npm test`, then run `npm --prefix examples/independent-builder install` and `npm --prefix examples/independent-builder run demo`. The package exposes focused `commerce`, `outcomes`, `policy`, `evidence`, `recipient` and `escrow` subpaths. The host must verify source contract logs, supply a durable per-scope lock and authenticated approver, reconcile ambiguous wallet sends, and obtain trusted receipt keys outside the receipt. The separate example's `verify-transfer` command can check a real Arc ERC-20 transfer without a wallet key.

## Pricing and two kinds of USDC

| GrowTendril service | Price when billing is enabled | What runs                                                                            |
| ------------------- | ----------------------------: | ------------------------------------------------------------------------------------ |
| Market scan         |               2 USDC per scan | Read connected sources, score signals, update the plan and propose tests.            |
| Influencer report   |            3 USDC per refresh | Rebuild a creator report with available profiles, contact routes and draft messages. |
| Campaign brief      |            2 USDC per rewrite | Generate a fresh brief; the first draft for a creator is free.                       |

Browsing, settings, team views and exports are not metered services. A failed or interrupted charged scan receives an idempotent credit refund. Prices and top-up bounds are defined in `src/lib/services.ts`. Billing is deployment-dependent: production charges require a configured Arc billing address. **Service credit pays GrowTendril; the workspace wallet pays external recipients.** The owner can fund a Billing invoice from the workspace wallet with an emailed confirmation code; Arc confirmation then adds prepaid credit. New paid workspaces start with Autopilot **off**, so a recurring scan requires an explicit cadence choice. Once enabled, a due scan can use credit soon after a top-up.

![Pricing screen](https://growtendril.xyz/dorahacks/04-landing-pricing.png)

## Trust boundaries and operational status

| Evidence                       | What it establishes                                       | What it does not establish                                      |
| ------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------- |
| Source-linked public post      | What a source published at a particular URL/time          | The author will buy or that the post caused a sale.             |
| Merchant-authenticated event   | Which merchant sent an order/referral claim               | That the claimed customer attribution is independently true.    |
| Verified merchant Arc log      | A payment lifecycle event occurred at a pinned contract   | Who the off-chain customer is without the merchant association. |
| Circle or Gateway status       | What the payment provider reports                         | A matching on-chain transfer until independently checked.       |
| Arc receipt and movement check | Observed sender, recipient, amount and transaction status | Business value, marketing causality or contract security.       |
| Sourcify exact match           | Published source reproduces deployed bytecode             | An independent security audit.                                  |

Provider secrets are encrypted at rest with AES-256-GCM; inbound events use HMAC verification and a replay window; user-supplied outbound URLs pass through an SSRF guard. Workspace queries are permission-scoped. Payment proposals have idempotency keys, execution locks and explicit reconciliation states. A read-only money-path doctor (`scripts/doctor.ts`) checks configured Circle and Arc dependencies without moving funds. See security utilities (`src/server/security`) and CI (`.github/workflows/ci.yml`).

The application and contract have different readiness levels. The production app's creator payments still use approval plus Circle wallet sends. The optional testnet escrow UI is available for evaluation. The mainnet escrow is deployed and independently source-matched, but funding and production routing await contract review and a tested migration. Merchant commerce outcomes require an actual connected merchant. Passkey creator-wallet onboarding requires compatible Circle Modular Wallet mainnet configuration; the signed recipient proof path is present but configuration-dependent. Public-source coverage depends on provider access and credentials. Example or demo records must be identified as examples.

## Stack and validation

- **Chain and contracts:** Arc mainnet for current live payment integrations; Arc testnet for escrow UI evaluation; Solidity 0.8.30 escrow with Cancun EVM settings.
- **Application:** Next.js 15 App Router, React 19, strict TypeScript, Tailwind CSS 4 and Drizzle ORM over Postgres, with PGlite for local use.
- **Wallets and payments:** Circle developer-controlled wallets, Circle App Kit, Gateway x402 batching, Arc USDC and viem reads.
- **AI and jobs:** LLMs draft and analyze; deterministic code controls financial actions. Jobs are queued with retries, with a separate worker option.
- **Authentication and operations:** email-code and Google sign-in, roles and permissions, encrypted integration secrets, notification webhooks and reconciliation jobs.
- **Checks run on 16 October 2026:** 346 application tests across 40 files, four standalone toolkit tests, one independent transfer-verifier test, seven Arc Foundry escrow tests, TypeScript checking and the production build passed. The independent example's transfer test uses a mocked Arc RPC; no live merchant sale or creator payout was executed by these checks. They are implementation checks, not an independent contract security audit.

## A five-minute walkthrough

1. Open the landing page, enter a website, and show that onboarding keeps the context without immediately charging for a scan.
2. In Overview, explain the next recommended action. In Discover and Customers, open one source-linked signal and inspect why it scored well.
3. Open Creators and a campaign. Show the published terms, human-reviewed post, capped reward and the distinction between draft outreach and sent outreach.
4. In Experiments and Customer value, show a tracked link, actual or clearly marked demo customer events, a refund if available, confirmed spend and the recommendation's assumptions.
5. In Wallet, Approvals and Receipts, show the exact recipient, amount, policy verdict, settlement state and Arc explorer link. Explain that a submitted transaction is not yet a verified transfer.
6. For Arc builders, open the standalone toolkit's README and independent example once its public link is available, then the [mainnet escrow source match](https://repo.sourcify.dev/5042/0x2964E74d30413DE186f5F4936Eb133Ab815845D3). State that the escrow is deployed but the product's live creator payouts still use Circle's wallet route.

The honest claim is: **GrowTendril connects growth evidence, reviewable experiments, controlled Arc spending and measured outcomes.** Its reusable components let other Arc builders compose that path. The remaining production milestone is to review and exercise the escrow end to end before moving live creator funds through it.
