# Arc growth tools

Small TypeScript tools for builders connecting Arc commerce to measured growth and controlled spending. `npm run arc:tools:build` writes the standalone ESM package to `dist/`. The package has no runtime dependencies; import a focused subpath such as `@growtendril/arc-growth-tools/commerce`. The root entry also exports Node.js receipt signing helpers and is intended for server runtimes.

The package is private while its public license and support policy are decided. The included [demo](../../examples/arc-outcome-demo.ts) uses only fixtures and sends no transaction:

```sh
npm run arc:tools:build
npm run arc:demo
```

## Compose a flow

1. Your chain adapter verifies the network, successful transaction receipt, canonical block, contract address and decoded event. Supply those facts as `CommerceEvent[]` to `reduceCommerce`. Use `commerceEventKey` as a unique database key and replay the full sorted history whenever a new log arrives. Do not accept event amounts or status from a merchant webhook alone.
2. Use `eligiblePurchase` after a refund hold. Match later refunds through `netPurchases` using both customer and order IDs. Feed the resulting outcome count and review score into `calculateReward`.
3. Build a `SpendIntent` with a globally unique ID, exact recipient and amount. `evaluateSpend` is pure; `reserveSpend` and `executeReservedSpend` require a durable `ReservationStore` whose `locked` operation is a serialized database transaction per scope. The store's totals must include reservations until reconciliation, including across day boundaries. Authenticating the approver and binding the `SpendApproval` to the exact intent is the host's responsibility. An `executing` reservation is ambiguous and must be reconciled from the wallet or chain before any retry.
4. Check the submitted transfer against expected chain, token, sender, recipient and amount with `verifyTransfers`. Create a portable receipt with `createReceipt`; consumers should call `verifyReceipt` using an externally trusted issuer key. An unsigned receipt proves only digest integrity, not issuer identity.

All monetary values in these tools use integer micro-USDC (6 decimal places), the precision of Arc's ERC-20 USDC interface. Arc's native gas balance has 18 decimals and must be converted separately.

`escrow` exports the ABI and deployed-bytecode matcher for the local `OutcomeRewardsEscrow` testnet prototype. Contract actions require an explicitly connected wallet. A host must verify the deployment's chain, bytecode, token and hold period before using it. The included `commerce-abi` reproduces the relevant event definitions from Circle's `AuthCaptureEscrow` reference; its [notice](THIRD_PARTY_NOTICES.md) and [Apache license](LICENSES/Apache-2.0.txt) are included.
