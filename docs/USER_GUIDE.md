# How to use GrowTendril

GrowTendril finds people who are ready to buy what you sell, shortlists the creators your customers
already follow, proposes small growth experiments, and — only when you approve — pays people in
USDC on Arc. This guide walks through it from sign-up to measuring results.

---

## Where your money goes

GrowTendril keeps two separate pots of money. Knowing which is which answers most questions.

| | **Credit** (pays GrowTendril) | **Workspace wallet** (your growth budget) |
|---|---|---|
| What it's for | Running the product: market scans, influencer reports, campaign briefs | Paying creators, bounty winners and data sellers for your experiments |
| Where you send USDC | GrowTendril's billing address on Arc (shown on the payment page, currently `0xdDE7B987A01717EEfCcA1Dc5280c164E2cCD133e`) | Your workspace's own wallet address on Arc (shown on the **Wallet** page) |
| Who controls it | Becomes prepaid credit on your account | A Circle wallet created only for your workspace; keys are held by Circle, never by GrowTendril staff |
| How it leaves | Each service deducts its fixed price when it runs: scan **2 USDC**, influencer report **3 USDC**, campaign brief **2 USDC** (first draft per creator free). Failed services are refunded automatically. | Only three ways: **(1)** a payment you approve to a named recipient, **(2)** a research purchase within limits you enabled, **(3)** you withdraw it to your own address |
| Limits | — | Every payment stays within your workspace's per-payment ceiling and mission budget. The ceiling starts at **10 USDC** and is editable in Settings. Payments taking the day's total above the daily limit ask you first; creator payouts always ask you first. |
| Proof | Receipt email with the Arc transaction | A receipt for every payment, checked against Arc; mismatches are flagged |

Browsing, the growth plan, exports, settings and teammates are free. Credit never expires.

> **Network:** everything is on **Arc mainnet** (chain 5042). On Arc, USDC is also the network fee
> token, so keep a few cents of extra USDC in any wallet you send from.

---

## 1. Create your account

1. Go to **growtendril.xyz** and click **Start a mission**.
2. Sign up with **Continue with Google**, or with your name, email and a password.
3. If you used email, enter the **6-digit code** we email you (valid 10 minutes).

## 2. Set up your workspace (about a minute)

1. On **Start with your website**, paste your site's address (e.g. `yourshop.com`).
2. Pick who your customers are (or let GrowTendril decide) and click **Set everything up**.
3. GrowTendril reads your public pages and fills in what you sell, who it's for, what customers
   search for, your competitors and location. It also creates a first **mission** (a goal with a
   budget ceiling) and safe spending rules — every payment asks you first.
4. Prefer to check each part? Click **Set up step by step** instead: Product → Customer → Mission → Autonomy.

Everything here can be changed later in **Settings**.

## 3. Add credit (to run scans)

1. Open **Billing** (the **Top up** button in the sidebar, or the credit badge).
2. Choose an amount (from **2 USDC**) and click **Pay on Arc**.
3. You'll see an exact amount such as `5.001721 USDC` — the last digits identify your payment.
   Pay it one of two ways:
   - **Pay with browser wallet** (MetaMask, Rabby…): GrowTendril adds Arc to your wallet if needed and
     asks you to confirm the transfer.
   - **From any wallet or exchange:** send the exact amount of USDC **on Arc** to the address shown,
     then (optionally) paste the transaction hash under *Already sent it?*.
4. The page watches Arc and confirms within seconds. The credit appears on your balance and you get a
   receipt by email.

> Sent a rounded amount or paid after the request expired? Paste the transaction hash on that
> request's page. Any payment of at least the requested amount to the billing address counts.

## 4. Run your first scan

1. On **Overview**, click **Run cycle · 2 USDC** (or **Run agent** in the top bar).
2. The operator reads your sources (Reddit, Bluesky, Hacker News, YouTube, GitHub for developer
   products, plus X and RSS if configured), scores what it finds and updates your plan. Watch it in
   **Agent runs** — a scan usually takes under a minute.
3. Want it to run on its own? Set **Autopilot** (top bar) to daily, every 6 hours or hourly — each run
   is one 2 USDC scan, and autopilot simply waits if your credit runs out.

## 5. Read what it found

| Page | What you'll see |
|---|---|
| **Discover** | The raw posts it read, each linked to its source |
| **Customers** | Companies and people showing buying intent, with the score breakdown and the posts behind it |
| **Narratives** | Topics in your market that are emerging, accelerating or fading |
| **Creators** | People who post about your space, ranked by relevance, recency, engagement quality and authenticity (bots are flagged) — not follower count |
| **Influencer report** | Shortlist with contact routes and a drafted first message (refresh: 3 USDC) |
| **Opportunities** / **Growth plan** | What to do next, who to reach, what each test would cost — exportable |
| **Daily brief** | A one-page summary of what changed |

GrowTendril never messages anyone for you — it drafts, you send.

## 6. Set up your workspace wallet (only needed to pay people)

1. Open **Wallet** and click **Create wallet on Arc mainnet**. Your workspace gets its own address.
2. Copy that address and send it Arc USDC from your own wallet or exchange (on the **Arc** network).
   The balance appears on the Wallet page.
3. **Kill switch:** **Freeze spending** on the Wallet page stops every payment instantly until you resume.

## 7. Choose your spending rules

In **Settings → Spend policy** you set how much the agent may do on its own:

- By default **every payment asks you first**.
- You can allow small research purchases (buying data about a company) to run automatically under a limit.
- **Creator payouts always need your approval.**
- Set **Per-payment hard ceiling** to the largest payment your workspace may make. New workspaces start at **10 USDC**; raise it to fit your real operating budget. Approval cannot override this ceiling or the mission and experiment budgets.
- The **Daily limit** controls automatic spending: a payment that takes the day's total above it needs your approval. You may approve payments above this total.

For larger payments, set a mission budget that covers the planned work, choose a per-payment ceiling that fits it, and fund the workspace wallet. Raising these limits does not add USDC. Existing workspaces keep their current effective limits until an owner or admin explicitly saves new rules.

## 8. Run experiments and creator campaigns

**Experiments** — GrowTendril proposes tests from your opportunities, each with a hypothesis, a
tracked link, a budget, a time limit and a stop condition. Open one to set who gets paid (for
non-creator work), record delivery, and see results.

**Creator campaigns** (to pay creators for posts):

1. Open **Creator campaigns** and create a campaign: topic, platform, brief, number of creators and the reward rules.
2. Open the campaign and **Invite a creator** from your shortlist. You get a private link — send it to them yourself.
3. The creator opens the link, accepts the terms, and gives their **payout address** and an ownership proof.
4. You **verify** the creator. They submit their post through their link.
5. After the campaign window, **review** the post (quality score); GrowTendril calculates the reward
   from the published rules and the tracked customer actions, and proposes the payment.

The reward pool must fit the campaign and mission budgets, and each creator's total reward must fit
the workspace's per-payment ceiling. Raise that ceiling in **Settings → Spend policy** before creating
a campaign with higher rewards. Every creator payment still needs your approval.

## 9. Approve payments

Every payment that needs you appears in **Approvals** (the bell lights up, and Slack/Discord if
connected). Each request shows:

- **who** gets paid (address, creator handle, whether you've paid them before, who set the address and when),
- **how much** and **why** (the experiment and its numbers),
- the **policy checks** that passed or failed.

Click **Approve** to pay or **Reject**. Approved payments are sent from your workspace wallet in USDC
on Arc. GrowTendril marks a payment **settled** only after Arc shows the exact amount reaching that
address. Every payment has a receipt under **Receipts** (and **Arc / Circle activity**) with its
Arc transaction link.

> Safety: if someone changes a payout address, that same person can't approve a payment to the new
> address for 24 hours — the most common way payments go to the wrong person.

## 10. Measure what worked

1. Share each experiment's **tracked link** — visits are counted automatically.
2. Connect your site or app: **Integrations → Inbound events** gives you a signed webhook. Send events
   such as `signup` or `purchase` with the visitor's `gos_ref` and your own customer ID as `visitorId`
   (add `value` on purchases).
3. **Customer value** then shows, per campaign: referred customers, how many activated, paid and came
   back, recorded revenue, **confirmed spend**, **cost per paying customer**, payback, and a plain
   recommendation (*continue testing*, *improve the funnel*, or *stop spending*).

## 11. Get notified

**Integrations → Outbound notifications:** add a Slack or Discord webhook (or your own signed JSON
endpoint) to be told about approval requests, settled or failed payments, finished scans and creator
posts. Use **Send test** to check it.

## 12. Invite your team

**Team → Invite a teammate** by email with a role. Owners and admins can change rules and approve; teammates use
the workspace owner's credit.

## 13. Take your money out

The owner can withdraw unused USDC from the workspace wallet at any time:
1. **Wallet → Withdraw USDC**: enter the amount (or **Max**) and your Arc address — twice, to catch typos.
2. Click **Email me a confirmation code**. The code only works for exactly that amount and address.
3. Enter the code and click **Withdraw**. You get a receipt, an email, and the Arc transaction link.

A few cents stay behind for Arc's network fee, and money already committed to a payment in progress
can't be withdrawn until it finishes.

---

## Quick reference

| I want to… | Go to |
|---|---|
| Add credit | **Billing → Pay on Arc** |
| Run a scan now | **Overview → Run cycle** |
| Run scans automatically | **Autopilot** (top bar) |
| Fund payments to creators | **Wallet** → copy address → send Arc USDC |
| Stop all payments | **Wallet → Freeze spending** |
| Approve or reject a payment | **Approvals** |
| See proof of a payment | **Receipts** or **Arc / Circle activity** |
| Change limits | **Settings** |
| Withdraw my USDC | **Wallet → Withdraw USDC** |
