# GrowTendril product audit — 15 October 2026

This is a code, build, test, public-site and read-only Arc verification pass. It is not an independent smart-contract security audit or proof that every authenticated production journey succeeds.

## What was checked

| Area | Result |
| --- | --- |
| Application types and production build | `npm run typecheck` and `npm run build` passed. |
| Application behavior | 340 tests across 38 files passed. They cover billing claims, payout reconciliation, merchant commerce, wallet proof, growth entry and other product flows. |
| Database migrations | `npx drizzle-kit check` passed after ordering the two new migration timestamps after migration 0015. This matters because the server runs migrations on startup. |
| Creator escrow | Seven Foundry tests passed offline. A read-only mainnet check matched the deployed runtime at `0x2964e74d30413de186f5f4936eb133ab815845d3` and Sourcify reported an exact creation and runtime source match. These checks do not establish contract safety. |
| Public deployment | The homepage and `/api/health` returned HTTP 200 during this pass. Health reported Circle authentication, AI, email, billing and Google configuration ready; it is not an authenticated end-to-end transaction test. |
| DoraHacks screenshots | All seven screenshot references in `docs/dorahacks/DETAILS.md` now use absolute public GitHub raw-image URLs. Each URL returned HTTP 200 and `image/png` in a HEAD check. DoraHacks' own paste preview still needs visual inspection. |

## Payment path finding

A market scan costs 2 USDC when Arc billing is enabled. The user tops up from their wallet to the configured `BILLING_ARC_ADDRESS`; once its Arc transfer is confirmed, the app grants prepaid credit. A scan subtracts credit from the workspace owner's database ledger. There is **no per-scan transfer** to the Circle operating wallet, an agent wallet or the creator escrow. A failed charged scan is refunded as credit. Creator payouts and paid external research use separate payment routes. If `BILLING_ARC_ADDRESS` is absent in production, billing mode is `off` and scans are free. The local `.env` currently names `0xdDE7B987A01717EEfCcA1Dc5280c164E2cCD133e`; confirm the hosted environment independently before describing that as the production recipient.

## Fixes made during this pass

- Made DoraHacks image URLs absolute and paste-safe, and converted tracked source references to absolute GitHub links. New, unpublished sources are described by path without pretending that the public repository already serves them.
- Added `metadataBase` for `https://growtendril.xyz` to the root Next.js metadata. The prior public HTML advertised social images on `http://localhost:8080`; the rebuilt code no longer emits the missing-metadata warning. A production deployment is required to change the live HTML.
- Corrected the timestamps of migrations 0016 and 0017, which Drizzle warned were ordered before migration 0015 and could be skipped on an existing installation.
- Clarified the scan-credit and wallet flow in the DoraHacks submission text.

## Remaining verification and risks

- A prior `npm audit --omit=dev` run reported 22 low and three moderate transitive advisories, including `@solana/web3.js`, `jayson` and `stream-json` in Circle-related dependencies; it reported no high or critical advisories. A retry could not reach the npm registry from this environment. Upgrade decisions require compatibility testing of the Circle SDK, rather than a blind dependency update.
- No authenticated production scan, top-up, creator payout, merchant callback, Gateway purchase or passkey wallet registration was executed. Those require real accounts, provider configuration and, in some cases, funds or a connected merchant. The passing tests use controlled fixtures and cannot establish live provider behavior.
- The mainnet escrow has not been independently security-audited or routed into production payouts. The visible escrow UI currently targets testnet; do not fund or route live creator payments through the mainnet contract without the deployment runbook's review and end-to-end checks.
- Several new source files and the mainnet deployment manifest remain untracked in the working tree, and current source changes are not published. Public GitHub links cannot evidence them until they are committed and pushed. The production metadata fix also remains undeployed.
- Absolute screenshot URLs should render in a Markdown-compatible editor, but DoraHacks may sanitize or proxy remote images. Inspect the pasted submission in its own preview before publishing.
