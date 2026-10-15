# GrowTendril Discord walkthrough

Allow about 7–9 minutes. Open the workspace in advance, choose one campaign with real or clearly marked demo records, and keep the Arc testnet explorer tab ready. If a section has no data, describe what the operator would see after connecting a source; do not imply it ran for that workspace.

**Opening (25 seconds):** “GrowTendril helps a small team move from knowing little about its market to running a measured growth test. It brings research, creators, customer signals and spending decisions into one workspace. I’ll show the journey from evidence to action to verified payment.”

| Section | What to show | What to say |
| --- | --- | --- |
| Overview | The next action and its reason | “The home screen gives the next useful decision for this workspace, such as reviewing an opportunity or an approval. It changes with the state of the business.” |
| Daily brief | Today’s concise summary | “This is the short operating update: what happened, what needs attention, and where I should go next.” |
| Discover | Source status and a research result | “We search connected public sources for customer needs, creator fit and market movement. Every finding should lead back to its source.” |
| Customers | A company and a public customer conversation | “For B2B teams we surface companies; for consumer products we also surface people asking relevant questions in public. We show the original conversation so a person can judge it.” |
| Narratives | One observed theme | “Narratives group recurring market language. They help us choose a message to test; they are signals, not proof of demand.” |
| Creators | A creator and fit signals | “We compare creators by topic, activity and engagement quality. The team still reviews fit and agrees on compensation.” |
| Influencer report | A report and draft message | “The report makes a creator decision easier and can draft outreach. The business decides whether to send it.” |
| Growth graph | A relationship from signal to opportunity | “The graph makes it easier to see how a source, customer problem, creator and experiment connect once there is enough data.” |
| Opportunities | A recommendation with rationale and proposed action | “This is where a signal becomes a reviewable proposal. You can inspect why we think it matters, the estimated cost and the next step.” |
| Growth plan | Current plan | “The plan joins the selected audience, opportunities, creators and tests under the same goal.” |
| Missions | Goal and budget | “A mission sets the business goal and the budget boundary before anyone spends.” |
| Creator campaigns | Brief, terms and accepted post | “A creator gets clear terms: base reward, quality criteria, capped outcome bonus and a payout address. We review the post and customer outcomes before proposing payment.” |
| Experiments | Hypothesis, success event and stop rule | “Each test has a hypothesis, budget, event to measure and a stop condition. We can learn from a test without pretending attribution proves causation.” |
| Customer value | A referred cohort and net recorded revenue | “This joins referred customers to later purchases. Refunds reduce net revenue and pending creator bonuses; missing event values stay visible.” |
| Wallet | Wallet status and balance | “The operating wallet funds approved payouts and services. It is separate from prepaid product credit.” |
| Approvals | Exact recipient, amount and reason | “Money requests are checked against spending rules. A founder can inspect the exact recipient and amount before approving.” |
| Arc / Circle activity | A settlement trace | “Here we follow Circle and Arc activity. A submitted payment is different from a verified transfer; mismatches need reconciliation.” |
| Receipts | A decision receipt and export | “Every payment decision keeps its policy result, approval and settlement evidence. A portable export can be authenticated with a configured issuer key.” |
| Agent runs | One run and its inputs/results | “This records what the agent tried, what the tools returned and where an operator needs to step in.” |
| Integrations | Connected sources and merchant commerce | “Sources feed research and events. The commerce connector verifies captured payments and refunds on Arc before they affect growth metrics.” |
| Team / Settings | Roles and spending rules | “Owners control permissions, business context and spending limits. Team members can see the work that applies to their role.” |

**Arc builder contribution (45 seconds):** “We built reusable Arc growth tools that stand outside this application: payment event replay, refund-aware outcome rewards, spending reservations, transfer checks and portable receipts. A separate example imports them without our app. We also deployed and [verified a creator reward escrow on Arc testnet](https://explorer.testnet.arc.io/address/0x2371d0f4a064d1eb5f154dd99d355a7f4fa71aa3). The contract bounds a prefunded reward and holds it during the refund window. This is a testnet prototype; production creator payments still use the existing approval and Circle wallet route.”

**Close (15 seconds):** “The core loop is: find a credible signal, choose a small test, measure a real customer event, review spending, then reconcile the outcome. The next production milestone is to validate the testnet payout journey end to end and review the contract before routing live funds through it.”

If asked whether every GrowTendril transaction already passes through the new escrow, say: “No. Gateway x402 purchases, bridges, direct sends and merchant sales each have their own settlement contracts or wallet rails. We verify and govern them in the app. Routing all funds through contracts would require separate vault and billing designs; the testnet escrow currently covers the creator reward use case.”
