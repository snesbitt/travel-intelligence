# CLAUDE.md

Guidance for Claude (and any AI agent) working in this repository. This is
the canonical source of truth for how the project is built and deployed.

## What this is

Travel Intelligence: a personal travel optimization agent for Susan,
sibling to The Fitness Log (thefitnesslog.org), The Streaming Scout
(streamingscout.org), and Vinyl Scout. The mission is not to find flights —
it's to optimize the whole trip decision (cost, comfort, upgrade potential,
award value, flexibility, risk, time) against a ranked list of what matters most on a
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
  sign-off. 2026-07-26 (radical-simplicity pass, Susan's sign-off): the
  seeded-RNG synthetic model that used to back unconfigured/unreachable
  runs was DELETED — there is ONE data path now. Offers come from the
  live feed (`/api/fares`) plus Susan's own browser scans
  (`/api/scan-offers`, Kayak/Booking); `runOptimization` with no offers
  returns `{ noLiveData: true, routeKnown: false, best: null }` and the
  UI renders an honest empty state naming the reason
  (`FALLBACK_REASONS`) — never synthetic figures. Do not reintroduce a
  synthetic fallback. Live offers are scored by `buildLiveCandidates`
  in `app.js`; mileage figures remain distance-scaled planning ranges
  (award space is not yet searched). Flight-time estimates for offers
  that omit a duration derive from great-circle distances via the
  hand-maintained `CITY_COORDS`/`CITY_IATA` tables — when adding a city
  to one, add it to both. Note `routeKnown` semantics since the
  deletion: live offers are real by definition, so top-level
  `routeKnown` is true whenever offers exist (candidate-level
  `routeKnown` still flags unresolved geometry); false now means
  "no real data at all".
- Destination/origin text (city or country name, free-typed) resolves to
  an IATA code via `toIATA()` in `app.js`: exact match against `CITY_IATA`
  or `COUNTRY_TO_IATA` first, then a whole-word fuzzy fallback that scans
  both tables and prefers the longest matching key. Fixed 2026-07-23: the
  original fallback used raw substring matching (`n.includes(key)`),
  which silently matched short keys like `"us"` or `"uk"` inside
  unrelated words (`"Muscat"` resolved to Chicago) — every match must
  now land on a whole word/phrase boundary. When adding a country or
  city, add it to whichever table fits; no need to duplicate across both.
  2026-07-24 (the SFO→Greenville incident): `lookupCoords()` received the
  identical whole-word fix — its raw substring scan had the same bug class
  toIATA's had. Same session: Greenville/Spartanburg → GSP added to both
  `CITY_IATA` and `CITY_COORDS`, and `runOptimization` now returns
  `routeKnown`. When a destination never resolves, the model previously
  fell back to a silent generic 7,500 km long-haul and the results card
  presented fully invented specifics ("Nonstop · 9h 34m · A330-300 ·
  Book on American ↗") as a bookable itinerary — Susan caught it against
  a real aa.com search (no nonstop SFO→GSP exists). The card now drops
  the booking link and shows an inline warning naming the unresolved
  city whenever `routeKnown` is false; the banner alone was not enough. Same-day follow-up at Susan's request: (1) an
  unresolved route now renders NO results at all — an honest error state
  naming the field that failed — instead of a modeled card with a warning;
  (2) ~50 US regional cities/airports added to both tables (name + code
  keys; ambiguous names go to the biggest US airport: charleston→CHS,
  columbia→CAE, rochester→ROC); (3) `liveSearchUrls()` in app.js builds
  route+date-prefilled deep links for the rec card — American's
  `/booking/search?slices=` format (verified live on aa.com before
  shipping) plus a prefilled Google Flights query for every carrier
  (also verified live). It returns no URL unless origin, destination and
  date all resolve, so a booking link can never point at a route the
  engine couldn't name. Follow-up same day: `displayCity()` (exported) renders
  `City (CODE)` from either a typed city or airport code everywhere routes
  appear (rec card, watched trips, .ics export); booking links moved to a
  `.rec-links` wrapping row and watched rows stack single-column on mobile
  (44px unwatch target) — no mid-phrase link wrapping at 375px.
- One exception to "modeled": `POINT_VALUATIONS` and `TRANSFER_BONUSES`
  in `app.js` are real published figures hand-copied from The Points
  Guy's monthly valuations / current-transfer-bonuses pages, each dated
  in the code and in the UI. Refresh them monthly (or when a program
  devalues) by re-copying — never let the shown as-of date go silently
  stale, and never present them as a live feed. Transfer bonuses expire:
  drop entries whose end date has passed when refreshing.
- 2026-07-25 multi-feed expansion (Susan: "discover more and better
  flight options", zero new signups, free tiers only):
  (1) **Price intelligence** — `fares.mjs` now passes through Google
  Flights' own `price_insights` (lowest price, low/typical/high level,
  typical range, price history), previously discarded; costs zero extra
  SerpApi quota. `priceIntelligence()` in app.js (pure, exported,
  tested) turns it into the Purchase-strategy verdict; the old
  booking-window heuristic remains as the labeled fallback when Google
  publishes no insight. (2) **Deep-scan feed** — `scan-offers.mjs`
  (`/api/scan-offers`, GET/POST, open like watch.mjs, "scanoffers-"
  keys in the watched-trips store) stores Kayak/Booking.com offers
  collected in Susan's own logged-in Chrome during a Cowork session
  (server-side scraping of those sites 403s and violates ToS; her
  browser doing her own searches doesn't — the Discogs-medians pattern).
  Frontend merges scans fresher than 24h into the live pool with a
  visible "Kayak · scanned Nh ago" source pill on rec card and
  alternatives; scan-only runs are honestly labeled as the scan feed.
  To run a scan: read Kayak/Booking results for a route in her browser,
  build {routeKey:"SFO-GBE-YYYY-MM-DD[-YYYY-MM-DD]", source, offers:[
  {carrier, priceTotal (total, USD), stops, durationMinutes}]} and POST
  it — sanitizeScan (tested) rejects malformed payloads. (3) Watched
  rows render their accumulated nightly checks as an inline sparkline.
  (4) Cost-score floor extended 4 → −80 in both modes: at the old floor
  every fare beyond ~1.5× budget scored an identical 4, so Cost stopped
  discriminating on expensive routes (caught in this build's e2e
  review; regression-tested, charter ANA case still holds).
- Backend: five live Netlify Functions, not static-only (corrected
  2026-10-30; `concert-match-check` stopped being a Netlify Function on
  2026-08-26 and is now a weekly GitHub Actions script,
  `scripts/concert-match-check.mjs`, that commits `data/concert-match-log.json`) —
  `netlify/functions/fares.mjs` (live fare search proxy to SerpApi, with
  a 15-min result cache keyed by search params, reuses the
  `watched-trips` blob store under a `farecache-` prefix to protect the
  SerpApi quota without adding a second store; the cache-key and TTL
  logic is exported as pure functions, `buildFareCacheKey`,
  `isCacheFresh`, `CACHE_TTL_MS`, and covered by `tests/fares.test.mjs`,
  12 assertions, no network/blobs mocking needed since `@netlify/blobs`
  is imported dynamically inside the handler rather than at module
  top-level), `scan-offers.mjs` (`/api/scan-offers`, stores Kayak/Booking
  fares scanned from Susan's own logged-in browser, under a
  `scanoffers-` prefix in the same store), `watch.mjs` (Blobs-backed
  watched-trips store; reached v4 2026-08-08, POST/DELETE now gated
  server-side by `checkWriteAuth()` against the `EDIT_SECRET` env var,
  matching `X-Edit-Key` header, and fails closed if the env var is
  unset, see the Conventions section below), `watch-check.mjs` (daily
  scheduled re-search of watched trips), `watched-trips.mjs` (`GET
  /api/watched-trips`, a privacy-scoped read of watched trips, only
  destination, coordinates, and dates, for Vinyl Scout's Concert Radar
  to cross-check against), and the GitHub Actions sweep above, which
  flags newly matching Concert Radar shows on already-watched trips.
  Scoring itself still runs client-side in
  `app.js` against live offers only, the seeded-RNG modeled fallback was
  deleted 2026-07-26 (see above), the Functions supply data, not
  scoring.
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
modestly-cheaper connection. 2026-07-25 addendum to this tuning: a seventh scored dimension, Time,
was added after Susan reported Fastest and Cheapest returning the same
pick — Risk only counts stops, so all-1-stop offer sets gave "Fastest"
nothing to rank by (duration was displayed, never scored). Fastest is
now Time-dominated (1.2); Best Overall gets a deliberately small Time
0.2 so this ANA-vs-United call keeps holding — pinned by a regression
test in tests/app.test.js. Known remaining blindspots, declined for
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
percentage next to its score bar, across all 7 dimensions (Cost, Comfort,
Upgrade, Award, Flexibility, Risk, Time — Time added 2026-07-25). Don't
collapse the Decision Framework into a single opaque number — the whole
point of the priority input is that the trade-off stays legible. (The
priority input itself was simplified 2026-07-18 from a 1–7 rank list to a
primary + optional secondary dropdown at Susan's direct request; the
weighting machinery and its visibility are unchanged, and a sort-by
control on the alternatives table lets the same shortlist be viewed
through any lens.)

External docs (README.md, guide.html) document the exact formula —
`computeWeights()`'s rank-to-weight conversion and `weightedScore()`'s
weighted sum — plus the full `PRIORITY_WEIGHTS` table, not just a
description of it. When a dimension or a weight changes here, update
those docs in the same commit; guide.html's "Six dimensions" text going
stale after Time was added 2026-07-25 (fixed 2026-07-27) is the
cautionary example — don't let the public docs drift from what `app.js`
actually computes.

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

### Write endpoints are gated server-side, not just in the client

Added 2026-08-08, after `watch.mjs` shipped v4. Any Netlify Function that
accepts a POST/DELETE (a real write, not a read) should check
`checkWriteAuth(req)` before touching the Blobs store, not just rely on
the client sending an `X-Edit-Key` header: `watch.mjs` sent that header
from `index.html` for a full day (since 2026-08-07) before the server
actually checked it, so anyone with the site URL could add or remove
watched trips regardless of whether they had the key. The pattern is the
same one `vinyl-scout-repo/netlify/functions/wishlist.mjs` established
first (v4, 2026-08-06): a pure `checkWriteAuth(req)` function comparing
`req.headers.get("x-edit-key")` against `process.env.EDIT_SECRET`,
called before any `getStore()` access so a missing/wrong key returns a
clean 401 rather than a 500, and fails closed (rejects every write) if
`EDIT_SECRET` is unset rather than silently accepting anything. Read-only
GET paths stay open; this is about protecting the metered daily search
quota and the shared store from an open write, not locking the whole
site down. `EDIT_SECRET` is a per-site env var, set independently in each
site's own Netlify project, not shared across the portfolio even when the
same passphrase is reused.

### The watcher spends quota on a schedule — cap is a spend decision

2026-07-26 (current state, reversing the 2026-07-20 decision at Susan's
direct request): `watch.mjs` caps watched trips at 6 (since
2026-08-11) and `watch-check.mjs` re-searches each every other day
(44h threshold), about 90 searches/month at the cap against the real
100/month free tier. See the quota-math comment at the top of watch.mjs.
That leaves about 10/month of headroom for manual runs, a trade Susan
chose knowingly. History of the cap: 3 (to 2026-07-20), 2, 3, then 6. Raising the cap further, adding
email/push alerts (needs a new credential), or increasing frequency are
quota/spend decisions — Susan's call, never the agent's. The watcher
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

The ringed-dot mark (`⦿` in the nav, a stroked ring + filled center dot
in `icons/`) matches the family style used by Vinyl Scout and The Fitness
Log exactly — same shape, sized to this site's `--accent` navy instead of
their maroon/teal. Don't replace it with an illustrative icon (a plane, a
compass, etc.) — the whole portfolio deliberately uses the same abstract
mark in a different accent color, not a bespoke logo per site. (2026-07-21:
unified from a plain `•` to `⦿` across all pages of this site and
Streaming Scout so the mark actually matches Vinyl Scout/Fitness Log's
bullseye, per Susan's cross-site logo-consistency request — this doc's
description of the mark was accurate, the glyph in source just hadn't
caught up. Same day, second pass: the glyph alone wasn't enough — Susan
flagged the two families still read as different sizes. `.brand .dot`
and `.brand .word` went from 15px/17px to 19px/24px (mobile) and
17px/19px to 22px/30px (desktop, `min-width:640px`), matching Vinyl
Scout's/Fitness Log's actual mark+wordmark proportions, not just their
glyph.)

### Saved preferences & trip memory (roadmap phase 07)

2026-07-21: the "Flight preferences" card now auto-saves to `localStorage`
(`tiPreferences` key) exactly like the wallet does — cabin, max stops,
preferred/avoided airlines, preferred alliances, departure/arrival time
preferences, airports to avoid, preferred seat, preferred hotel brand(s),
typical travel style, and the upgrade-wins log all persist across
sessions. Trip-specific fields (origin, destination, dates, budget, bags)
deliberately do NOT persist — those vary trip to trip, and defaulting them
would be wrong, not helpful. Three small pure functions in `app.js` use
these saved fields, each personalizing a suggestion or an insight, never
the seven-dimension scoring math itself (radical simplicity: this
personalizes what the agent SAYS, not what it computes):

- `travelStyleFallback` — a saved "Relaxed"/"Efficient"/"Luxury" style is
  the LAST fallback `suggestPriorities` checks, after every trip-specific
  signal (tight budget, long-haul Economy, business/exact-date, premium
  cabin) has had a chance to fire. A saved default must never override
  what this specific trip's own numbers say.
- `flagsDislikedAirport` — checks saved "airports to avoid" against
  origin/destination/preferred-airport/nearby-airports/via only (both the
  raw city name and its resolved IATA code via `toIATA`). It does NOT
  claim to catch a disliked airport used as a connection — live offers
  carry a stop COUNT, never a specific connection airport — and the
  insight text says so explicitly when it fires.
- `matchUpgradeWinCarrier` — if the saved upgrade-wins log mentions the
  recommended itinerary's carrier, that's surfaced as a reason to try the
  same play again. Free-text substring match only, never scored.

Preferred seat and preferred hotel brand are saved for reference only —
this site doesn't have a seat map or a hotel-scoring engine, so don't let
either field's copy imply they affect the recommendation.

## Working principles

- Pure logic lives in `app.js`, no DOM code. If scoring logic needs a DOM
  reference, that's a sign it belongs in `index.html`'s render layer
  instead.
- Never hardcode secrets: the one credential (`SERPAPI_KEY`) lives in
  Netlify env vars, and `EDIT_SECRET` (the watch/unwatch write-auth gate,
  added 2026-08-08) works the same way; any future key goes the same
  route, never in source.
- **Radical simplicity wins** (Susan's standing rule, 2026-07-19).
  Simple beats complicated-and-bloated for this project, every time. The
  backend stays five single-file Functions and one blob store; a new
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

No build step; five single-file Functions ride along with the static
pages. GitHub is connected and Netlify auto-deploys main:

```bash
git add <the specific files you changed>   # never -A: untracked cruft sits in the repo
git commit -m "..."
git push           # Netlify auto-deploys main (pages + Functions)
```

Claude sessions commit; Susan runs the push (the cloud bridge has no
network) — and per the standing rule in ~/Projects/CLAUDE.md, every
"commit is ready" message must end with the exact push command block.

## Editorial standard

Editorial standard for external-facing docs: see ~/Projects/project-hub/EDITORIAL_STYLE.md (added 2026-07-28). Also re-verify dimension/Function counts against app.js when touching docs; they drift.


## History

Dated changelog entries (2026-07-26 to 2026-10-26) are in `CHANGELOG_ARCHIVE.md`. Read it before reversing an old decision. New entries: add a short dated bullet below, and move anything longer than ten lines to the archive.

- 2026-11-03: "Tests: All jobs have failed" was the `valuations_due` early warning, not a code bug: TPG published November and `copiedOn` was 2026-10-20. Re-copied all 6 card and 18 airline figures from the live page read in Chrome (diffed, all match), bumped `asOf`/`copiedOn`. Not added, scope call for Susan: Rove (2.05), U.S. Bank (1.6). `TRANSFER_BONUSES` untouched (its rows are expired and filtered at render). The warning fires on the 1st of each month by design; the re-copy stays manual.
- 2026-11-03 (later): card values had two hand-kept copies, `POINT_VALUATIONS.cards` and `TRANSFER_PARTNERS[card].value`, and the refresh only updated the first (Citi 1.9 vs 1.95, Wells Fargo 1.75 vs 1.8 on the held-card transfer path in `index.html`). `TRANSFER_PARTNERS` now takes each card's value from `POINT_VALUATIONS.cards` at load, so one monthly re-copy updates everything shown. Two tests in `tests/app.test.js` pin it. Marriott Bonvoy (hotel currency, no row in `cards`) keeps its own `value` of 0.8; TPG's November hotel table says 0.75. Not changed, Susan's call.
