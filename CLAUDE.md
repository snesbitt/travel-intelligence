# CLAUDE.md

Guidance for Claude (and any AI agent) working in this repository. This is
the canonical source of truth for how the project is built and deployed.

## What this is

Travel Intelligence: a personal travel optimization agent for Susan,
sibling to The Fitness Log (thefitnesslog.org), The Streaming Scout
(streamingscout.org), and Vinyl Scout. The mission is not to find flights —
it's to optimize the whole trip decision (cost, comfort, upgrade potential,
award value, flexibility, risk) against a ranked list of what matters most on a
given trip, and to explain the weighting, never hide it.

This project holds the same bar as the other three: it's meant to be a
flagship example of what an agentic build looks like — planned in phases,
honest about what's real vs. modeled, and legible to a non-technical reader,
not just a demo. Hold every future change to that standard.

- Data source: live fares via `netlify/functions/fares.mjs`, a proxy to
  SerpApi's Google Flights engine (v1 targeted Amadeus Self-Service;
  Amadeus decommissioned that portal 2026-07-17, so v2 pivoted). The
  credential lives ONLY in the Netlify env var `SERPAPI_KEY`, never in
  source. Free tier is 100 searches/month — each "Run the optimization"
  costs one search, so don't add auto-refresh loops without Susan's
  sign-off. When unconfigured or
  unreachable, the frontend falls back to the deterministic scoring
  model on hand-maintained reference ranges and SAYS SO in the banner
  and results header — the fallback must never be silent. Live offers
  are scored through the same six-dimension engine (`buildLiveCandidates`
  in `app.js`); mileage figures remain distance-scaled planning ranges
  in both modes (award space is not yet searched). Flight times and
  fare scaling in model mode derive from great-circle distances via the
  hand-maintained `CITY_COORDS`/`CITY_IATA` tables — when adding a city
  to one, add it to both.
- One exception to "modeled": `POINT_VALUATIONS` and `TRANSFER_BONUSES`
  in `app.js` are real published figures hand-copied from The Points
  Guy's monthly valuations / current-transfer-bonuses pages, each dated
  in the code and in the UI. Refresh them monthly (or when a program
  devalues) by re-copying — never let the shown as-of date go silently
  stale, and never present them as a live feed. Transfer bonuses expire:
  drop entries whose end date has passed when refreshing.
- Backend: none yet — fully static, scoring runs client-side.
- Frontend: `index.html` is the Input Card + results, importing the pure
  scoring logic from `app.js` via a plain `<script>` tag (no build step,
  no bundler).

## Repository layout

- `index.html` — the optimizer UI. Collects the Input Card, calls
  `window.TravelIntel.runOptimization(inputs)`, renders the result.
  Keep view/DOM logic here; keep scoring logic in `app.js`.
- `app.js` — pure scoring engine, no DOM access. Exports
  `runOptimization`, `computeWeights`, and the reference-data tables via
  `window.TravelIntel`. Every reference table at the top of the file has
  a comment explaining it's hand-maintained, not fetched — keep those
  comments accurate if the numbers change.
- `about.html`, `roadmap.html`, `guide.html` — public, self-contained
  explainer pages (no build step, no imports). Shared house style with
  the sibling sites: numbered sections on About, a phased Live/Planned
  roadmap, a stepper-nav walkthrough on Guide. Linked from the masthead
  nav on every page.
- `style.css` — shared house style. Cream/serif shell (`--bg: #efe8db`,
  Fraunces italic for titles/accents), with a deep-navy accent
  (`--accent: #1f3a5f`) distinguishing this site from its siblings while
  keeping the same component family (`.card`, `.pill-nav`, `.phase`,
  `.step`, `.stat-strip`, `.field-note`). Travel-specific components
  (`.rec-hero`, `.score-grid`, `.alt-table`, `.insight-list`, the form
  classes) are appended at the bottom of the file — do not duplicate the
  shared classes above them.
- `netlify.toml`, `manifest.json`, `icons/` — static deploy + PWA config.

## Conventions (do not change without Susan's explicit approval)

### Honesty about what's real

Every price and mileage figure shown must be clearly a computed/reference
value, never presented as a live quote. The sync banner on `index.html`
and the "Data" step on `guide.html` are the two places this promise is
made explicitly — if a future change adds a real data source, update both
rather than leaving them stale.

### Award recommendation threshold

The engine only recommends redeeming miles when the computed cents-per-
mile clears ~1.6¢ (`awardRecommendation` in `app.js`). Don't lower this
threshold to make more redemptions look "strong" — it exists because the
agent brief explicitly says never recommend miles unless the redemption
is genuinely strong.

### "Best Overall" is value-conscious by explicit decision

2026-07-19: Susan reviewed a live SFO→Tokyo result where United nonstop
($1,512) outranked ANA 1-stop ($761) under Best Overall Experience and
ruled the cheaper fare should win. The BOE priority vector's Cost weight
went 0.3 → 1.4 — the minimal value that flips that case (verified
against the real candidate scores) while a nonstop still beats a
modestly-cheaper connection. Known remaining blindspots, declined for
now: Comfort ignores carrier product quality (ANA economy > United
economy, invisible to the model) and the upgrade-friendliness table is
editorial — revisit only with Susan.

### Asia routes prefer Asia-based carriers — Susan's standing rule

2026-07-19: on Asia-bound trips, carriers in `ASIAN_CARRIERS` get a
+12 Comfort bonus (`ASIA_COMFORT_BONUS` in app.js) — home-market product
quality the cabin+stops model can't otherwise see. The rule announces
itself in the insights whenever active; keep it visible, never silent.
Destination-in-Asia is a coordinate box on the city table.

### Weighting must stay visible

`index.html`'s results view always renders the per-dimension weight
percentage next to its score bar. Don't collapse the Decision Framework
into a single opaque number — the whole point of the priority input is
that the trade-off stays legible. (The priority input itself was
simplified 2026-07-18 from a 1–7 rank list to a primary + optional
secondary dropdown at Susan's direct request; the weighting machinery
and its visibility are unchanged, and a sort-by control on the
alternatives table lets the same shortlist be viewed through any lens.)

### Miles + cash is either/or, never both-hidden

Every candidate carries both a cash price and an estimated miles price
(`milesEst`/`feesEst`/`candCpp`), and the UI shows the recommended one
with the other as the visible alternative. The flip point is the same
1.6¢/mile bar as `awardRecommendation` — keep the two thresholds in
sync if either ever changes.

### Density: long cards collapse, honesty never does

Cards with many rows collapse by default to their high-signal subset
(`.ti-toggle` / `.ti-hidden` in `style.css`): loyalty balances show only
funded programs, the TPG valuation list shows the top 6, the upgrade
timeline shows the goal + first 3 steps. Rules: the collapsed view must
never hide the pay-with recommendation, a mode label (live vs. modeled),
or an as-of date — those stay visible in every state; and every toggle
states what it's hiding ("Show all 18 programs"), never a bare "more".

### Upgrade tactics target Economy → Business

When the booked cabin is Economy/Best Value, `upgradeTactics` opens with
a "Your goal" block pricing the three routes to Business for the
specific trip (PE ladder, direct bid, miles+copay — computed from
CABIN_BASE ratios, the 20–40% bid band, and a distance-scaled upgrade-
award range), then runs the dated timeline against Business. Don't
regress it to one-cabin-up advice — that framing buried the actual goal.
Trip purpose is Vacation / Business / Both only.

### The watcher spends quota on a schedule — cap is a spend decision

`watch.mjs` caps watched trips at 3 and `watch-check.mjs` re-searches
each at most once per day (~90 searches/month at the cap, against the
real 100/month free tier — see the quota-math comment at the top of
watch.mjs for the exact accounting; that leaves thin headroom for manual
runs). Raising the cap, adding email/push alerts (needs a new
credential), or increasing frequency are quota/spend decisions — Susan's
call, never the agent's. The watcher
records the live fare FLOOR (cheapest offer), not the engine's weighted
winner, and the UI labels it exactly that way — don't blur that line.
Watched trips store routes and dates only, never wallet data.

### The saved wallet is browser-local

Cards and loyalty balances persist via `localStorage` (`tiWallet` key)
only — no backend, nothing transmitted, stated plainly in the UI. If a
backend ever changes that, update the wallet copy and the sync banner
in the same commit.

### Spend requires Susan's go-ahead

Domain registration, paid API keys, or any other real spend is a decision
left to Susan, never taken on the agent's behalf — same rule the other
two sites operate under.

### Mobile-first

`style.css` is written mobile-first, same as the sibling sites: base rules
target a narrow viewport, `@media (min-width: 640px)` blocks layer on the
desktop refinements (wider `.wrap`, larger type, multi-column grids). The
Input Card, results view, and every table (`.alt-table-wrap` scrolls
horizontally rather than breaking layout) were checked at a 375px
viewport before shipping. Check any new section at 375px before adding
it — this is the primary way Susan will open the site.

### Brand mark

The ringed-dot mark (`•` in the nav, a stroked ring + filled center dot
in `icons/`) matches the family style used by Vinyl Scout and The Fitness
Log exactly — same shape, sized to this site's `--accent` navy instead of
their maroon/teal. Don't replace it with an illustrative icon (a plane, a
compass, etc.) — the whole portfolio deliberately uses the same abstract
mark in a different accent color, not a bespoke logo per site.

## Working principles

- Pure logic lives in `app.js`, no DOM code. If scoring logic needs a DOM
  reference, that's a sign it belongs in `index.html`'s render layer
  instead.
- Never hardcode secrets — the one credential (`SERPAPI_KEY`) lives in
  Netlify env vars; any future key goes the same way, never in source.
- **Radical simplicity wins** (Susan's standing rule, 2026-07-19).
  Simple beats complicated-and-bloated for this project, every time. The
  backend stays three single-file Functions and one blob store; a new
  feature that needs more infrastructure has to earn it, and the first
  question about any addition is "what can we delete instead?"
- **Brevity.** Explanations are a paragraph, not an essay. Don't
  re-explain how the scoring model works in general, Susan has read this
  file.
- **Build to spec.** If it's not in this file, `README.md`, or a direct
  ask, it's not in scope.
- **Honesty over confidence.** If a number is a reference range rather
  than a live figure, say so in the UI, not just in this file.

## Deploy workflow

No build step; three single-file Functions ride along with the static
pages. GitHub is connected and Netlify auto-deploys main:

```bash
git add -A
git commit -m "..."
git push           # Netlify auto-deploys main (pages + Functions)
```

Claude sessions commit; Susan runs the push (the cloud bridge has no
network) — and per the standing rule in ~/Projects/CLAUDE.md, every
"commit is ready" message must end with the exact push command block.
