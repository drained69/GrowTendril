# Arc deployment and transaction routing

The GrowTendril creator reward escrow was deployed on **Arc testnet** on 15 October 2026: [contract and verified source](https://explorer.testnet.arc.io/address/0x2371d0f4a064d1eb5f154dd99d355a7f4fa71aa3), [deployment transaction](https://explorer.testnet.arc.io/tx/0xc309e7da13e9b76153ddf51fb9b1684e7f179dc23296ca72fba585e8a72338fb). Its address, constructor values, source hash and compiler settings are in [`contracts/deployments/arc-testnet.json`](../contracts/deployments/arc-testnet.json). The explorer API returned `is_verified: true`. The contract is unfunded and no creator reward has been paid through it.

The same build was deployed on **Arc mainnet** on 15 October 2026: [contract](https://explorer.arc.io/address/0x2964e74d30413de186f5f4936eb133ab815845d3), [deployment transaction](https://explorer.arc.io/tx/0x29d876d0d5ee161897959252af559a380fbb6511a409160edabe7b5b9134a822), and [`contracts/deployments/arc-mainnet.json`](../contracts/deployments/arc-mainnet.json). The onchain runtime, USDC token and 72-hour hold were checked against the local build. [Sourcify verified](https://repo.sourcify.dev/5042/0x2964E74d30413DE186f5F4936Eb133Ab815845D3) an exact creation-bytecode and runtime-bytecode match on 15 October 2026. **Arc explorer source publication is still pending** because its API returned a Cloudflare challenge. No campaign was created or funded through this deployment, and the production app has not switched to it.

## What uses a contract today

| Product flow | Current settlement path | What can pass through the new escrow |
| --- | --- | --- |
| Creator rewards | GrowTendril policy, founder approval, then Circle App Kit send on Arc mainnet | The deployed mainnet escrow can prefund a campaign and release bounded creator rewards after a 72-hour refund hold once verification, review, and app routing are complete. Mainnet creator payouts still use the existing route. |
| Merchant sales | Merchant's `AuthCaptureEscrow` contract, if configured | The new commerce connector verifies that merchant contract's Arc logs and turns captures/refunds into attributable outcomes. Merchant funds stay in the merchant's escrow. |
| Agent purchases (x402) | Circle Gateway's seller-required verifying contract | The custom creator escrow cannot replace the Gateway contract in a seller's signed x402 terms. GrowTendril applies policy and verifies receipts around that settlement. |
| Bridge/treasury | Circle App Kit and CCTP/Gateway | The creator escrow cannot bridge funds. A separate treasury vault design would require its own threat model, contract and migration. |
| Workspace withdrawals and direct sends | Circle controlled wallet/App Kit | Routing these through a contract would require moving custody into an approved vault and changing wallet ownership and recovery. |
| Customer billing top-ups | Direct USDC payment to the configured billing address | A billing receiver contract could replace the address after invoice reconciliation and refund behavior are specified. |

Arc's USDC ERC-20 interface is `0x3600000000000000000000000000000000000000` on testnet and mainnet, with 6 decimal places. The native gas balance uses 18 decimal places; the contract only uses the ERC-20 interface. Circle's [Arc addresses](https://docs.arc.io/arc/references/contract-addresses) and [EVM differences](https://docs.arc.io/arc/references/evm-differences) are the source for these values. Current RPC and explorer URLs are in [Arc's network reference](https://docs.arc.io/arc/references/rpc-endpoints).

## Reproduce and verify a deployment

1. Install [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry). Use an operator-controlled Arc testnet wallet with test USDC for gas. Keep its private key outside Git. The deployment script accepts `ARC_DEPLOYER_PRIVATE_KEY`; for this local development workspace it can also read `PRIVATE_KEY` from `.env` without logging it.
2. Compile and run Arc's runtime tests from the `contracts` directory:

   ```sh
   arc-forge test --network arc --offline
   ```

3. Generate matching UI bindings and perform a read-only chain/gas check (add `--network mainnet` to select Arc mainnet explicitly):

   ```sh
   npm run arc:contracts:generate
   npm run arc:escrow:deploy -- --check
   ```

4. For a new deployment, `npm run arc:escrow:deploy -- --broadcast` uses testnet; `npm run arc:escrow:deploy -- --network mainnet --broadcast` uses mainnet. It checks chain ID, USDC code, gas estimate and balance, transaction receipt, deployed bytecode, token and refund hold. Save the returned address and transaction hash in a new deployment manifest. The script never creates or funds a campaign.
5. Publish the exact source using the [Arc deployment guide](https://docs.arc.io/arc/tutorials/deploy-on-arc). The current deployment used Solc 0.8.30, optimizer 200 runs, Cancun EVM, USDC `0x3600000000000000000000000000000000000000`, hold `259200`, Blockscout verifier `https://explorer.testnet.arc.io/api/`, and chain ID `5042002`. Confirm the explorer contract endpoint reports `is_verified: true` and compare the runtime bytecode to the local artifact apart from the two immutable constructor values.

For the mainnet deployment, the source is [`contracts/src/OutcomeRewardsEscrow.sol`](../contracts/src/OutcomeRewardsEscrow.sol), the compiler is `v0.8.30+commit.73712a01`, optimizer is enabled with 200 runs, EVM version is `cancun`, and constructor arguments are USDC `0x3600000000000000000000000000000000000000` and hold `259200`. The ABI-encoded constructor arguments are `0x0000000000000000000000003600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003f480`. Sourcify verification is complete with exact creation and runtime matches; its automatic submission to Arc Blockscout received HTTP 403. Submit these values to the [Arc mainnet explorer](https://explorer.arc.io/address/0x2964e74d30413de186f5f4936eb133ab815845d3) when its verification interface is available, and only mark `explorerSourceVerified` true after the explorer shows the source.

The app's campaign escrow page still loads the **testnet** manifest by default. It checks chain ID, bytecode, token and hold period before offering explicit wallet actions. The contract itself enforces its funded maximum, one reward per recipient, bounded quality/outcomes, a review window, refund hold and dispute resolution. The business still attests which post and customer events are real. The mainnet deployment has no campaign funds and the contract has not had an independent security audit.

## Production routing sequence

1. Exercise testnet with separate owner, creator and arbiter wallets; include a purchase, partial/full refund, a disputed reward, and a failed/retried transaction. Reconcile all app ledger entries against chain receipts and the public explorer.
2. Review the contract's threat model and obtain an independent audit before any mainnet funds. Decide whether the reviewer's approved base/quality award can be rejected in a dispute and how a creator recovers an inaccessible wallet.
3. Decide which payments the product will custody in contracts. A single creator escrow cannot route arbitrary x402, bridge or billing transactions without replacing their payment protocols. Build any additional vault or receiver as a separate module with scoped permissions, withdrawal recovery and explicit limits.
4. For a mainnet creator settlement route, complete the security review, register the verified deployment on chain ID `5042` as an allowlisted rail, and only then switch the existing founder approval/execution flow to fund and queue rewards. Keep exact onchain transaction reconciliation and a migration path for pending mainnet App Kit payments.
