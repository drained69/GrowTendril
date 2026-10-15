# GrowTendril product review and improvements

Reviewed on 14 October 2026.

## Main finding

GrowTendril has an extensive operating workflow, but the starting experience made users learn the product's sections before choosing a useful action. The strongest improvement is to organize the experience around the next decision: understand the business, find relevant evidence, review a small test, and inspect its recorded results.

The product should lead with customer and creator discovery. Budget controls, approvals, payment traces, and first-party attribution give that discovery a practical operating workflow.

## Reference and scope

[Origami's public site](https://origami.chat/) starts with a website or customer description. It presents recommended actions with explanations of deliverables and credit usage. Its public demos connect requests to research tables and campaign preparation. The signup screen provides the handoff to the application. Those observable patterns informed the changes below.

Origami's authenticated application was not inspected, and no account was created. Its advertised scale, contact verification, and outcome claims were not independently verified. This review does not establish feature parity.

GrowTendril's current repository, existing product guide, all 22 sidebar destinations, billing, and the local onboarding handoff were reviewed. Browser checks used an isolated database with clearly marked example opportunities and no production payment credentials. Live customer acquisition, provider availability, and payment settlement were not exercised.

## Implemented

### Website-to-workspace entry

- The landing page now accepts a website and offers an alternative to describe the business.
- The website survives signup, verification routing, and the sign-in alternative, then appears prefilled in onboarding.
- The initial automatic setup path shows a single entry step. The four-step progress display remains available for manual setup.
- The page shows that setup is free and scans use paid service credit.
- The landing and authentication copy describe the actual growth workflow and distinguish creator approvals from optional research spending.
- Entering a website navigates to setup. It does not automatically create a workspace or run paid work.

### A next decision on Overview

The main heading and primary action now come from workspace state:

| Observed state | Recommended next step |
| --- | --- |
| A spending request is pending | Review the request, or view it when the role cannot approve |
| A scan is queued or running | Inspect its progress |
| Read-only member | Review the growth plan |
| Product context is missing | Review the profile or contact the owner |
| No mission | Set a goal or contact an administrator |
| No available source for this audience | Review sources before paying for a scan |
| An open opportunity exists | Review the strongest opportunity, even if service credit is low |
| Service credit is insufficient | Add credit, or contact the workspace owner when using their balance |
| A completed scan produced no open opportunities | Review search terms or browse evidence |
| The workspace is ready for its first scan | Find opportunities, with the scan price displayed |

Wallet provisioning is no longer part of the first-scan checklist. It remains available when the business needs to pay people or buy data. Manual product profiles can support discovery without a website.

The top bar also directs operators with insufficient credit to billing or the workspace owner. An operator following an already-running job keeps its progress view.

### Recommendations that explain the action

Overview and Opportunities now share recommendation cards. Each includes:

- the kind of opportunity and its title;
- why it deserves attention;
- an expandable proposed action;
- estimated spending, confidence, and priority;
- a link to review the underlying opportunity.

The cards use stored workspace opportunities. An unset spending estimate appears as “Not estimated.” They do not create a campaign or authorize a payment.

### Consumer customer discovery

The old Customers page only listed companies. The analysis engine already creates individual PERSON opportunities from public requests, comparisons, and questions, but a consumer business could miss them while viewing Customers.

Customers now includes “People asking in public,” showing the conversation, its author and source when available, the suggested next step, and a link to the original post. Consumer workspaces receive an appropriate description and empty state. Company discovery remains available.

The opportunity detail page also displays the original post for individual conversation opportunities. Both source lookups check the current workspace. A missing or out-of-scope post remains unlinked.

### Navigation with fewer choices at once

The default sidebar exposes 11 core links. The other 11 remain in expandable groups and in search. Visiting an additional view opens its group automatically. Existing routes and page labels remain available.

The core links keep the daily workflow visible: Overview, Daily brief, Discover, Customers, Creators, Growth plan, Experiments, Customer value, Wallet, Approvals, and Integrations.

## Review of each section

“Next” items are product recommendations, not implemented features.

| Section | Assessment and recommended direction | Status |
| --- | --- | --- |
| Overview | A business should see its next useful decision before its operational statistics. | State-based heading and action shipped |
| Daily brief | A useful concise update. Keep its counts grounded in stored records and give the top recommendation a clear action. | Reviewed; retain |
| Discover | Source links and connection status provide useful context. A future search should explain which terms and providers produced a result. | Reviewed; search explanation is next |
| Customers | Company-only presentation did not serve the advertised consumer audience. Individual public requests need equal visibility. | Consumer conversations and source context shipped |
| Narratives | Useful research context, but volume and vocabulary overlap should be presented as observed indicators. | Moved into additional intelligence views |
| Creators | The scoring includes topical fit, activity, engagement quality, and authenticity. Estimated creator cost still needs confirmation from the creator before committing a campaign. | Reviewed; quote confirmation is next |
| Influencer report | Useful detail for deciding whom to contact. Keep the drafted message and the business's responsibility to send it clear. | Available under more intelligence |
| Growth graph | Useful for exploring relationships after data exists. It adds little to an empty workspace. | Available under more intelligence |
| Opportunities | Recommendations need an action and rationale users can inspect before they act. | Shared review cards and individual source evidence shipped |
| Growth plan | Already joins contacts, content, creators, experiments, and rules. It should become the principal working view after discovery. | Kept as a core link; deeper customization is next |
| Missions | Good separation of goals and budgets. A template's fixed name can diverge from an edited numeric target. | Available under more growth; target-aware names are next |
| Creator campaigns | Clear briefs, review criteria, and reward rules. The creation form has many economic inputs and should offer a small-budget starting template that fits the mission. | Available under more growth; suitable templates are next |
| Experiments | Hypothesis, success event, budget, and stop condition form a strong review unit. A guided edit screen would make proposals easier for a new user to evaluate. | Kept as a core link; guided editing is next |
| Customer value | Strong distinction between referral attribution and causal lift. Outcomes depend on incoming customer events. | Kept as a core link; guided event setup is next |
| Wallet | Funding is required for payouts, but wallet setup should not delay ordinary market research. Platform configuration errors should eventually use customer-facing language and offer a clear support path. | Removed from first-scan requirements; error copy is next |
| Approvals | Preserves human review and hard-rule enforcement. Keep this visible when a request is pending. | Core link and pending-request recommendation shipped |
| Arc / Circle activity | Useful payment operations view. Its batch-reference heuristic must remain distinct from proof of an individual data purchase. | Available under more money |
| Receipts | Useful decision accountability, including denied actions. It belongs behind the action for a first-time user. | Available under more money |
| Agent runs | Necessary for progress and failure diagnosis. Empty and active states should lead here when appropriate. | State-based progress links shipped; more money view retained |
| Integrations | Source status and inbound events determine research and measurement quality. A future guided setup should focus on the user's audience and immediate goal. | Core link and missing-source recommendation shipped |
| Team | Role-based collaboration is already implemented. Team provides a useful path to the owner when a member cannot fund scans. | More workspace view and owner-contact routing shipped |
| Settings | Product context, policy, and cadence should be editable when needed, without becoming required homework before first value. | More workspace view; contextual links retained |
| Billing / credit | Fixed service pricing is clear, but users need the distinction between service credit and an operating wallet before funding either. | Entry copy, low-credit routing, and contextual explanation shipped |

## Next product priorities

1. **An editable proposal before starting an experiment.** Show the specific work, recipient if applicable, budget, success event, and stop rule together. Keep payment approval separate from planning a test. Reuse existing experiment and policy services.
2. **Guided measurement setup.** Help a business connect one actual signup or purchase event and verify that it arrived. Keep missing purchase values and margin assumptions visible.
3. **A simple campaign starting template.** Default the proposed reward pool to a size that fits the active mission, available budget, and workspace per-payment ceiling. Reserve funds only when the user creates the campaign.
4. **A constrained conversational planner.** Let users explain or refine the goal in ordinary language, then convert that request into an editable proposal through the existing permission and policy boundaries. Keep research claims tied to collected evidence.
5. **Better research coverage and freshness feedback.** Explain which sources were used, what was unavailable, when evidence was captured, and what a paid research request could add. Add enrichment providers only after validating access, costs, and provenance.

These are separate implementation projects. The current changes do not add automated outreach, verified contact enrichment, anonymous visitor identification, or guaranteed customer acquisition.

## Validation

- All 323 tests across 35 files passed, including the 11 journey, billing-readiness, permission, source-context, and workspace-isolation checks in the updated journey suite.
- Type checking and the production build passed, including the consumer conversation query and original-post evidence view.
- Browser inspection covered public website entry, signup/sign-in handoff, website prefill, populated and empty local states, additional navigation views, and workspace/billing pages.
- At a 390 px viewport, the dashboard, recommendations and website entry had no horizontal overflow. Mobile navigation expanded its additional pages and closed after choosing a destination. Both light and dark dashboard themes were inspected.
- Preview records are examples marked DEMO. No production database, wallet, payment credentials, or deployment was used.

## Main implementation references

- [Website entry](/Users/uba/projects/growthos/src/components/marketing/website-start.tsx)
- [Onboarding destination](/Users/uba/projects/growthos/src/server/auth/next-step.ts)
- [Next-action selection](/Users/uba/projects/growthos/src/lib/next-growth-step.ts)
- [Overview](/Users/uba/projects/growthos/src/app/app/page.tsx)
- [Recommendation cards](/Users/uba/projects/growthos/src/components/features/growth/opportunity-cards.tsx)
- [Customer conversations](/Users/uba/projects/growthos/src/server/queries/customer-conversations.ts)
- [Customers](/Users/uba/projects/growthos/src/app/app/customers/page.tsx)
- [Navigation](/Users/uba/projects/growthos/src/components/layout/nav-config.ts)
- [Journey and isolation tests](/Users/uba/projects/growthos/tests/growth-entry.test.ts)
