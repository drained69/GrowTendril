# GrowTendril demo video: restructured prompt

Paste everything below the line into a fresh Claude Code session in this repo.
Items marked **[YOU DECIDE]** are the only blanks left.

---

You are my motion designer. Make a product demo video for **GrowTendril**, an autonomous growth operator for any business: you give it a product, a goal and a USDC budget, and it finds who is ready to buy, decides what is worth doing, pays for it within rules you set, and proves what worked. It is for founders and small teams who want customers without hiring a growth team.

## 1. Read the repo before designing anything

The video must show the real product. Do not invent copy, screens or numbers.

- **Brand tokens:** `src/app/globals.css` (`@theme`). Dark operator console. bg `#0a0a0b`, surface `#111113`, ink `#ededf0`, accent `#3987e5`, good `#22a855`, warning `#f0a92c`, critical `#e5484d`. Radii 3/5/7/10px. Fonts: Inter Variable (UI) and JetBrains Mono Variable (numbers, ids), both via `@fontsource-variable`.
- **Logo:** `src/components/layout/logo.tsx`. A blue rounded square with a white rising line and dot, plus the "GrowTendril" wordmark. Re-draw it exactly as SVG.
- **Landing copy:** `src/app/(marketing)/page.tsx`. Headline "Your autonomous growth operator." and the decision-receipt card (Action / Service / Why / Value of info / Policy / Payment / Result / Confidence).
- **Onboarding:** `src/app/onboarding/page.tsx`. Four steps: Product, Customer, Mission, Autonomy.
- **Overview, Approvals, Wallet:** `src/app/app/page.tsx`, `approvals/page.tsx`, `wallet/page.tsx`. Sidebar labels are in `src/components/layout/nav-config.ts`.
- **The story to follow:** `DEMO_STEPS` in `src/server/demo/script.ts` (the 8-step guided demo) and the "A worked example" section of `README.md`. Read the seed data in `scripts/seed.ts` for the fictional company, Meterline, and its 500 test USDC.
- Read the component files for each screen you rebuild so labels, badges (`DEMO`, `SIMULATED`, `PAID · x402`) and number formats match.

If a string is not in the repo, leave it out.

## 2. The viewer

You are a **founder with a product and a small budget**, using the built-in DEMO workspace (Meterline, "First 100 Developers"). Walk through it as they would:

1. **Set the mission.** Onboarding: product, ideal customer, goal and budget, and the hard spending rules in the Autonomy step.
2. **Find who is ready to buy.** The agent scans public conversation and surfaces Acme Labs with buying intent, shown with its score breakdown and linked evidence. Confidence is below the 80% commit threshold, so it needs more information.
3. **Buy the missing data.** The agent works out the information is worth buying, the policy engine allows it, and it pays over x402 with USDC on Arc. Show the receipt and confidence rising (60% to 90%).
4. **Pick the creator.** It turns the strongest creator opportunity into an experiment with a hypothesis and stop condition, ranked by relevance, not followers, and drafts an evidence-backed brief.
5. **You approve the spend.** The creator payment is above the autonomous limit, so it lands in the Approvals inbox. The founder approves it and USDC is sent. (Use the same wording the UI uses for "SIMULATED" versus testnet.)
6. **Proof.** Conversions arrive through the creator's tracking link, then the agent compares cost per customer, stops the loser and reallocates budget. End on the sealed decision receipt and the daily brief.

Payoff line, from the README: GrowTendril optimizes **verified growth per dollar spent**.

## 3. Plan first

Before writing any animation, show me a table: scene, start and end time in seconds and bars, camera move, on-screen caption, sounds. Wait for my OK. Target 45 to 60 seconds. Fast cuts, nothing slow.

## 4. Build

- **Remotion (React).** Every frame is code and it renders to MP4 with no extra installs. Put it in a new top-level `video/` folder with its own `package.json` so it does not touch the Next.js app.
- **Device frames.** The product is a dense desktop web console, so:
  - 16:9 uses a browser window or laptop frame at real UI proportions.
  - 9:16 is not just a crop. Rebuild the same screens in a phone frame with layouts reflowed so text stays readable. Reuse the same timing file.
- **Rebuild the interface** in React using the tokens above. Show real interaction: typing into the onboarding fields, visible cursor and click ripples, agent-log lines streaming in, the Approvals badge appearing in the sidebar, a toast or notification sliding in when a payment settles, the confidence meter and USDC balance counting.
- **Camera.** Push in on what matters (score breakdown, the policy verdict, the Approve button), pull back between steps.
- **Captions.** Beside or under each step: a number, a label, a headline, one supporting line. Readable on a phone (min about 44px at 1080p wide, larger in 9:16). Use the product's own voice, e.g. "Who wants your product?", "Where should the next dollar go?".
- **Open** on the logo and the line "Your autonomous growth operator." **Close** on the logo, **"Autonomous growth operator"** (three words), and the CTA: **[YOU DECIDE: link, e.g. the repo github.com/drained69/GrowTendril or a live URL, and button text such as "See it work"]**.
- **Frame 0 is a finished cover image:** logo, headline, one hero UI card (the decision receipt), nothing mid-animation.

## 5. Sound, all in code, nothing licensed

- Choose a tempo (suggest 120 BPM, 4/4) and put every scene start on a bar line so cuts land on the beat. Synthesize the music with the Web Audio API or a small offline renderer that writes a WAV (pads, bass, light percussion; a calm, precise, confident feel to match the dark console).
- UI sounds: tap, typing ticks, send, incoming message, notification, a "payment settled" chime, an approve confirm.
- **One timeline file** (e.g. `video/src/timeline.ts`) holds every scene time and every sound cue in frames. Both the visuals and the audio mixer read from it, so they cannot drift.

## 6. Quality gates

- Render still frames for every scene (`npx remotion still`) and inspect them yourself before the final export. Fix anything cropped, overlapping, off-brand or too small to read.
- Export **1920x1080** and **1080x1920**, H.264, high quality (CRF about 16 to 18, 30 fps, AAC audio) so it survives social compression.
- **Data honesty.** All numbers come from the DEMO seed (fictional Meterline, 500 test USDC), and the video says so on screen ("Demo data is fictional", matching the product's own `DEMO` badge). At the end, tell me which figures are examples versus values read from the repo. No keys, no real users, no wallet addresses, no emails from `.env*` or real accounts.

## 7. Deliverables

- `video/` source, the timeline file, rendered MP4s for both sizes, the scene review stills, and a short README with the render commands.
- Commit on this branch and push. Do not open a PR.

My polish bar is a modern developer-tool launch video (clean, confident, precise). Do not copy any reference.
