# Arc integration review for GrowTendril

Reviewed 14 October 2026. This is a product and integration review, not a contract audit or an implementation. Reference coverage: the public READMEs of six Circle repositories below, plus the commerce payment webhook source; local attribution, creator rewards, policy, execution, reconciliation, receipts, and signals code. These references were not all run locally. Novelty statements are relative to this reviewed scope.

Implementation update, 15 October 2026: the reusable TypeScript tools, merchant connector, refund-aware rewards, portable receipts, passkey recipient proof and Arc testnet escrow prototype are now in this workspace. See the [package README](../packages/arc-growth-tools/README.md) and [deployment runbook](ARC_DEPLOYMENT_RUNBOOK.md). Mainnet contract routing and merchant configuration remain separate rollout work.

## Recommended direction

Build a reusable **outcome-to-payout flow**: a customer follows a creator referral, a merchant captures a payment, the reward engine evaluates eligibility, the business approves a reward, and a wallet adapter sends USDC with an independently checked receipt.

GrowTendril is the first consumer. A separate affiliate, ambassador, or bounty app should be able to use the same modules without adopting GrowTendril's database, UI, authentication, or AI agents.

## Existing references and their fit

| Reference | Existing example | GrowTendril integration | Incremental contribution |
| --- | --- | --- | --- |
| [arc-commerce](https://github.com/circlefin/arc-commerce) | USDC credit purchases, receipt checks, transfers and bridging | Compare against existing credit funding | Low differentiation; GrowTendril already has credits |
| [arc-p2p-payments](https://github.com/circlefin/arc-p2p-payments) | Passkey Modular Wallets, gas sponsorship, sandbox funding | Easier creator recipient onboarding | A reusable campaign recipient component, rather than another P2P demo |
| [arc-ecommerce-payments](https://github.com/circlefin/arc-ecommerce-payments) | Authorization, capture, charge, cancellation and refunds | Payment lifecycle to referral outcomes | A connector that preserves net revenue and reward eligibility across retries and refunds |
| [arc-escrow](https://github.com/circlefin/arc-escrow) | Deposit, deliverable validation, release/refund | Optional prefunded creator campaigns | Outcome bonus rules and disputes around an existing escrow pattern |
| [arc-nanopayments](https://github.com/circlefin/arc-nanopayments) | x402 buyer/seller, Gateway batching and a spending limit | Existing paid research purchases | Reusable mission budgets, approvals, reservations and settlement evidence |
| [arc-fintech](https://github.com/circlefin/arc-fintech) | Treasury and cross-chain examples | Optional future funding convenience | Lower product fit than attributable growth rewards |

Generic escrow, paid agent APIs, spending limits, and gasless payments are already represented. The opportunity is the interoperable business workflow around those primitives.

## Three modules to build

### 1. Commerce outcomes and rewards — strongest product fit

**New integration:** consume verified merchant payment lifecycle events, join them to an order's referral and pseudonymous customer, then update customer value and reward eligibility. An authorization alone must not become a purchase reward. Partial captures and refunds need explicit rules.

**Existing starting points:**

- `src/lib/creator-campaigns.ts`: campaign budget commitments, quality scoring, capped base/quality/outcome rewards.
- `src/server/domain/growth/creator-campaigns.ts`: identity review, contributions, eligible outcomes and reward proposals.
- `src/server/domain/growth/attribution.ts`: first-party referral attribution and idempotent ingestion.
- `src/server/domain/growth/customer-value.ts`: customer cohorts and recorded purchase value.
- `src/app/api/events/route.ts`: authenticated merchant event ingestion.

**Proposed reusable surface:** a framework-independent event reducer and reward calculator, with separately supplied storage and payment adapters. Event identity should include merchant, chain, contract, payment identifier, transaction hash and log index. Store currency and integer base units explicitly. Persist the referral-to-order association at checkout; it cannot be inferred from a transfer alone.

Define `reserved`, `captured`, `refunded`, `voided` and `expired` order facts. Distinguish eligible outcomes, pending rewards, approved rewards, and verified payouts. Define the purchase threshold and refund hold window before launch. After payout, a late refund becomes a recovery/review case; a USDC transfer cannot simply be reversed.

The initial connector should support USDC only. GrowTendril's current event values are micro-USDC; accepting EURC under that field would misstate value. A later currency adapter must preserve original amounts and any explicit conversion basis.

**Other builders:** affiliate systems, ambassador programs, community incentives and paid contributor applications.

### 2. Agent spending policy and approval tools — fastest extraction

**Existing starting points:** `src/server/domain/agent/policy.ts`, `execute.ts`, `ledger.ts`, and `payees.ts` already contain deterministic policy checks, approval handling, committed budgets, execution claims and recipient controls.

Extract the pure policy evaluator first. Replace GrowTendril-specific mission/category assumptions with supplied configuration. Keep transaction orchestration in a separate adapter layer: concurrency-safe reservations, current-policy rechecks, authenticated approvers, and recipient validation are stateful responsibilities.

**Proposed flow:** evaluate → reserve → request approval where needed → recheck → execute → reconcile. Bind approval to the exact recipient, asset, chain, amount limit, action identity and validity window. Retried calls share an idempotency key; an intentionally new payment gets a new key.

Circle's nanopayments reference already has a spend-limit flag. The additional value is a reusable policy and reservation system that accounts for simultaneous jobs, human decisions, mission budgets and changing conditions. Keep creator payouts under human review.

**Other builders:** purchasing agents, research assistants, treasury automation and bounty platforms.

### 3. Settlement verification and portable receipts — useful independently

**Existing starting points:** `src/server/domain/billing/arc.ts`, `src/server/domain/reconcile/wallet.ts`, and `src/server/domain/agent/decisions.ts`.

Extract transaction matching behind a read-only chain adapter: expected sender, recipient, asset and amount → pending, reverted, verified or mismatch. Preserve unexpected outflows and verification evidence. Support configurable network identifiers, contracts and precision rather than copying deployment constants.

Expose a standalone verifier or CLI plus a versioned receipt format. Include policy and approval references, expected versus observed movement, network identity, transaction evidence and verification status. Existing receipts store a SHA-256 digest; that alone does not authenticate a publisher if both body and digest can be replaced. Portable receipts need a verifiable issuer signature or an independently trusted commitment, with defined key rotation.

For Gateway purchases, distinguish accepted off-chain authorization from eventual batch settlement. Do not represent the former as an independently confirmed on-chain payout.

**Other builders:** marketplaces, payment operators, finance dashboards and agent monitoring tools.

## Product surfaces

| GrowTendril section | Suggested addition |
| --- | --- |
| Integrations | Merchant payment connector and connection health |
| Creator campaigns | Reward formula, eligible purchase count, refund hold and payout state |
| Customer value | Captured revenue, refunds and net revenue with attribution provenance |
| Approvals | Reward calculation, supporting events, current recipient and budget impact |
| Wallet / Arc activity | Expected versus observed transfer; pending and mismatched checks |
| Receipts | Portable receipt export and verification result |
| Agent runs | Which module was called, its inputs, policy result and output evidence |

Keep these within the existing sections; adding another set of top-level navigation links would make the product harder to present.

## Prerequisites found in the code

1. **Refunds:** the conversion event enum has no first-class refund event. Customer value sums purchase values, and creator eligibility has no refund reducer. Add an append-only order adjustment model and recalculate pending rewards and net revenue; don't overwrite original evidence.
2. **Verification status:** `confirmSend()` can transition a mined mismatch to `SETTLED` while setting `chainCheck: "mismatch"`. Customer value currently classifies costs by `SETTLED` alone. Preserve actual observed costs separately, flag exceptions, and require a matching verified transfer before claiming that the approved recipient reward was paid.
3. **Evidence:** merchant HMAC proves sender authentication and payload integrity, not honest conversion reporting or causal marketing impact. Explicitly distinguish merchant-attested events, chain-confirmed payments and human review. Keep personal customer data off-chain.
4. **Reference webhook:** the inspected [commerce webhook source](https://github.com/circlefin/arc-ecommerce-payments/blob/master/app/api/webhooks/payments/route.ts) has signature checking commented out and increments partial totals before lifecycle-event insertion. Its handler does not itself deduplicate before those increments. Build a verified, transactional event ingestion adapter; do not copy the handler unchanged.
5. **Network:** the checkout reference is a testnet demonstration; GrowTendril's current policy is configured for mainnet spending. Demonstrate the connector in an isolated testnet example with configurable adapters. Never route testnet receipts through production payout logic.
6. **Budget versus escrow:** current campaign reservations are database commitments, not funds locked in a contract. A funded escrow feature requires a separate contract integration and an explicit release/dispute model.

## First deliverable and demonstration

Release one thin working example around the commerce connector, reward calculation, policy evaluation and verification. Suggested package names are working names, not existing published packages:

- `outcome-rewards`: normalized events, eligibility and deterministic reward calculations.
- `spend-policy`: pure decisions and separately documented orchestration adapters.
- `arc-payment-evidence`: transaction checks and portable receipt verification.

Publish schemas, adapter interfaces, license, setup instructions and meaningful tests for duplicate events, partial captures/refunds, concurrent reservations, changed recipients, denied approvals, retries and mismatched transfers. Include a small independent merchant or affiliate example that imports the modules. That second consumer is the evidence that the tools are composable.

**Demo:** referral link → order → confirmed capture → eligible bonus → human approval → testnet USDC payout → independently verified receipt. Replay the same capture and show no second reward; refund before eligibility and show the bonus removed. The existing campaign review waits until its 14-day window ends, so use clearly labelled completed-campaign fixtures for a short demonstration rather than quietly bypassing that rule.

The passkey recipient flow can follow later. The [P2P reference](https://github.com/circlefin/arc-p2p-payments) currently lists a private-registry onramp dependency; wallet onboarding and fiat funding should be treated as separate integrations. Generic escrow and treasury expansion should follow the core outcome workflow.

## Presentation wording

Current capability: “GrowTendril connects growth research, creator campaigns, customer events, spending approvals and Arc payments.”

Proposed contribution: “We are extracting an outcome-to-payout toolkit so other Arc builders can connect customer outcomes to capped rewards, review spending and verify payouts without building an entire growth platform.”

After the independent example and packages work, change “are extracting” to “provide.” Until then, present these as proposed integrations, not shipped capabilities.
