# DoraHacks submission — field-by-field answers

Copy each block into the matching field. Short fields fit as-is; longer fields are wrapped
to be legible when pasted. **Three fields marked `[FILL IN]`** need your personal handles.

---

## Public builder profiles (GitHub, X, Farcaster) *

```
GitHub: https://github.com/drained69
X: [FILL IN — e.g. https://x.com/your_handle]
Farcaster: [FILL IN — e.g. https://warpcast.com/your_handle, or write "n/a" if none]
```

> I only know your GitHub (`drained69`) from the repo URL. Add your X and Farcaster handles,
> or write "n/a" for anything you don't have. All three are listed as required, so write "n/a"
> rather than leaving blank.

---

## Link to your live deployment on Arc mainnet *

```
https://growtendril.xyz
```

Health endpoint (confirms Circle + Arc are live):
`https://growtendril.xyz/api/health` → `{"ok":true,"custody":"circle","billing":"arc",...}`

---

## Arc mainnet contract address or a transaction hash we can verify *

```
GrowTendril is a USDC-native app on Arc mainnet (chainId 5042). It does not deploy its own
contract — it integrates with Arc's canonical USDC and Circle's Gateway contracts, and the
system emitter, to read, reconcile and pay in USDC on Arc.

Live GrowTendril addresses verifiable on Arc mainnet:
• Billing / top-up address (receives USDC on Arc):
  0xdDE7B987A01717EEfCcA1Dc5280c164E2cCD133e
  → 41 transactions sent on Arc mainnet, current USDC balance ~0.096 USDC.
  https://explorer.arc.io/address/0xdDE7B987A01717EEfCcA1Dc5280c164E2cCD133e

Arc contracts GrowTendril's code integrates with (src/server/integrations/circle/config.ts
and src/server/domain/billing/arc.ts):
• USDC ERC-20 on Arc:       0x3600000000000000000000000000000000000000
• Circle Gateway Wallet:    0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE
• Circle Gateway Minter:    0x2222222d7164433c4C09B0b0D809a9b52C04C205
• USDC system emitter:      0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE

The system emitter is Arc's canonical log source for every USDC movement (native + ERC-20).
GrowTendril reads it to verify that every outgoing payment reached the approved address for
the approved amount — the chain is the independent witness, not Circle's response.
```

---

## Public repo *

```
https://github.com/drained69/GrowTendril
```

---

## In two sentences, what does your project do? *

```
GrowTendril is an autonomous growth operator for any website: it listens where your
customers talk, scores who is ready to buy and shortlists the creators your customers
already follow — then, when you say yes, pays creators and data sellers in USDC on Arc,
one approval at a time, with every payment verified on-chain. A deterministic policy
engine caps every single payment at 10 USDC, enforces mission budgets and named
recipients in code (not a prompt), and holds any payment that Arc doesn't confirm as
"unverified" until the chain says otherwise.
```

---

## What does it use Arc for? *

```
Arc is GrowTendril's money layer end-to-end. USDC on Arc is both the unit of account and
the gas token, so founders fund one wallet with one asset and the operator can run.

1. BILLING — pay-per-service, in USDC on Arc
   Workspaces top up prepaid credit by paying USDC on Arc to a BILLING_ARC_ADDRESS the
   operator controls. Each top-up is an invoice for an exact amount (the requested amount
   plus a small identifier). GrowTendril watches Arc for the matching Transfer, credits
   the balance, and services (market scan 2 USDC, influencer report 3 USDC, campaign
   brief 2 USDC) deduct from that balance when they run. No webhook, no payment processor,
   no card. If someone rounds the amount or pays after expiry, a reviewable exception is
   opened rather than silently sitting on the funds.
   (src/server/domain/billing/index.ts + src/server/domain/reconcile/billing.ts)

2. CREATOR AND BOUNTY PAYOUTS — Circle wallets on Arc, signed server-side
   Each workspace gets its own Circle developer-controlled EOA on Arc mainnet. Approved
   creator and bounty payouts are sent in USDC on Arc through Circle App Kit (appKitSend).
   The policy engine enforces a 10 USDC per-payment hard cap (LAUNCH_CEILING_USDC) in
   code, before signing. A wallet created on another chain never signs on Arc — the
   custody guard refuses it.
   (src/server/integrations/circle/wallets.ts + appkit.ts + config.ts)

3. ON-CHAIN DATA PURCHASES — x402 over Circle Gateway, capped by quote
   When the agent decides it's worth buying more intel on a company, it pays over x402
   through Circle Gateway. GrowTendril splits the flow in two: quote(url) fetches the
   seller's terms (402 + PAYMENT-REQUIRED), the policy engine runs on the QUOTED price,
   and pay(quote) signs a TransferWithAuthorization (EIP-712) via BatchEvmScheme. The
   scheme's onBeforePaymentCreation hook enforces an absolute amount cap, so a seller
   that changes its price between quote and payment cannot be paid more than was
   authorized.
   (src/server/integrations/circle/x402.ts)

4. ARC AS THE INDEPENDENT WITNESS — system-emitter reads
   USDC on Arc has one balance but two interfaces: native (18 decimals) and the ERC-20
   contract (6 decimals, the micro-USDC units GrowTendril stores). A native send never
   calls the ERC-20 contract and emits no ERC-20 Transfer. GrowTendril reads the system
   emitter at 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE — which logs every USDC movement
   — and falls back to the ERC-20 log only when a receipt carries no system log. Circle
   reporting a transaction as "sent" is not proof. A payment moves to SETTLED only when
   Arc shows the approved amount reaching the approved address, and nothing else leaving
   the wallet in that transaction. Everything else is held unverified or opened as a
   reconciliation exception.
   (src/server/domain/billing/arc.ts + src/server/domain/reconcile/wallet.ts)

5. UNIFIED BALANCE AND BRIDGES
   Circle App Kit's unified balance gives operators one chain-abstracted view of
   operating capital. Cross-chain bridges to move budget to another chain are blocked
   at mainnet launch by the policy engine, so funds stay on Arc.
   (src/server/integrations/circle/appkit.ts, src/server/domain/agent/policy.ts)

Every number on screen — a budget, a cap, a receipt, an invoice, a cost-per-paying
customer — is denominated in USDC on Arc and tied to a decision receipt (table
decision_receipts) that stores the on-chain hash and the explorer URL. GrowTendril is
only possible on a USDC-native chain: on any gas-token chain, operating a growth agent
that pays dozens of small amounts cleanly would require fiat rails or a second asset
to pay gas with. Arc removes that whole class of friction.
```

---

## Had you deployed to Arc before this project? *

```
No. GrowTendril is my first deployment on Arc mainnet.
```

> If you've deployed something else on Arc before, replace this with that project's name
> and link.
