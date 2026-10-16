# GrowTendril release and Arc toolkit audit — 16 October 2026

This pass reviewed the current checkout's product/payment boundaries, release packaging, documentation, tests, and build. It is a code and local-behavior audit, **not** an independent smart-contract security audit or a live end-to-end payment certification. External Circle, Arc RPC, GitHub, merchant and DoraHacks behavior require their own connected accounts and production checks.

## Verified in this pass

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Application tests | 346 passed across 40 Vitest files | `npx vitest run --no-file-parallelism`; includes billing, invoice claims, wallet-funded scans, job refunds, permissions, reconciliation, x402 and commerce fixtures. |
| TypeScript | Passed | `npm run typecheck`. |
| Production build | Passed | `npm run build` after replacing the independent example's symlinked local install with a packed copy. Static DoraHacks assets are included under `public/dorahacks/`. |
| Standalone toolkit | Four tests passed and package built from the separate checkout | Outcome/refund replay, policy approval and hard limits, idempotent reservation/execution, exact transfer matching and receipt authentication. |
| Independent consumer | Demo and one offline RPC verification test passed | Imports `@growtendril/arc-growth-tools` by name. The demo is explicitly fixture-only; the verifier checks exact vs mismatched ERC-20 USDC transfers and makes no signature or transaction. |
| Contract tests | Seven Arc Foundry tests passed | `forge test --offline` in both the application and standalone checkout. Tests cover hold, disputes, refund reductions, duplicate recipients, funding and unused funds. |
| Package archive | Verified | `npm pack --dry-run` includes `LICENSE`, `NOTICE`, third-party attribution, README and compiled entry points. The toolkit has no runtime dependencies. |
| Publication boundary | Reviewed | Separate checkout contains 33 source/configuration files, no symlinks, no absolute private application paths and no hits for the checked private-key/API-token patterns. Fresh Git history contains only the exported toolkit. This pattern scan cannot prove absence of every possible secret. |
| Dependency advisories | Toolkit: zero production advisories. Application: 22 low, three moderate, zero high/critical. | `npm audit --omit=dev` on 16 October 2026. The application findings are transitive through Circle adapters: `elliptic` (low) and `stream-json` (moderate). Upgrading or overriding a Circle payment dependency requires compatibility testing before release. |

## Money-path findings and controls

- Billing invoice settlement claims a transaction hash once, checks the Arc billing recipient and amount, and credits the actual confirmed micro-USDC payment. A market scan then charges the **application credit ledger**, not a second on-chain payment. Workspace wallet USDC and Gateway balance remain separate.
- New paid workspaces start with Autopilot off. The wallet-funded invoice flow requires the owner, an emailed code bound to the exact amount/recipient/invoice, and an Arc receipt before credit is granted. It blocks automatic retry after an ambiguous wallet send.
- Job failure and expired-lease recovery refund a charged scan attempt transactionally and idempotently before retry or final failure. The current tests exercise both cases.
- Creator and other direct sends use policy and approval checks. The reconciliation path compares the observed Arc transfer with the approved recipient and amount; mismatches become exceptions. Gateway authorization and later batch status are distinct.
- Merchant commerce events require a configured contract, canonical successful receipt and decoded log. The merchant still supplies the off-chain customer/referral association; chain evidence alone cannot prove marketing causality.
- `OutcomeRewardsEscrow` is deployed on Arc mainnet and testnet, but the application currently routes live creator payouts through Circle wallet sends. The contract is unfunded in the deployment record and has **not** received an independent security audit.

## Open release gates

1. **Public GitHub repository:** `/Users/uba/projects/arc-growth-tools` is a clean, Apache-2.0-licensed local Git repository, but has no GitHub remote. The GitHub CLI is not authenticated and the GitHub integration is not connected in this task, so public visibility, fork access and public CI cannot yet be verified. Do not submit a private application-repository link as proof of open source.
2. **DoraHacks screenshots:** the Markdown now uses `https://growtendril.xyz/dorahacks/...` and corresponding files exist in `public/dorahacks/`. The customer-value and billing screenshots come from an illustrative test workspace and are labelled as such. The URLs become public only after the application change is deployed; check each image in an unauthenticated browser before pasting the submission.
3. **Live provider checks:** the read-only money-path doctor passed local key/secret format checks but could not reach Circle or Arc RPC from this execution sandbox; `DATABASE_URL` was absent locally. This is not evidence of a production outage or a live success. Re-run `npm run doctor` from a networked production operations environment.
4. **Real transaction example:** the independent verifier accepts a real Arc ERC-20 transfer hash supplied by a builder, but this pass used an offline RPC fixture. No new live merchant sale or creator payout was made to manufacture demonstration evidence. A reviewed public transaction and a connected merchant would strengthen the submission.
5. **Dependency follow-up:** the application retains 25 low/moderate transitive advisories in Circle-related dependencies. Review upstream fixes and exercise Circle wallet/App Kit paths before changing versions or overriding `stream-json`; the standalone toolkit has no production dependency advisories.
6. **Escrow rollout:** test the creator campaign end to end on testnet, complete an independent contract security review, then explicitly switch and reconcile the mainnet payout route before stating that production creator rewards use the escrow.

The tests and build support the implementation claims above. They do not establish that every authenticated production journey, provider call, newly hosted screenshot, or public repository link works.
