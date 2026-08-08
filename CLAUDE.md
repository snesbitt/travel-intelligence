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
- Backend: four live Netlify Functions, not static-only —
  `netlify/functions/fares.mjs` (live fare search proxy to SerpApi, with
  a 15-min result cache keyed by search params — reuses the
  `watched-trips` blob store under a `farecache-` prefix to protect the
  SerpApi quota without adding a second store; the cache-key and TTL
  logic is exported as pure functions — `buildFareCacheKey`,
  `isCacheFresh`, `CACHE_TTL_MS` — and covered by `tests/fares.test.mjs`,
  12 assertions, no network/blobs mocking needed since `@netlify/blobs`
  is imported dynamically inside the handler rather than at module
  top-level), `scan-offers.mjs` (`/api/scan-offers`, stores Kayak/Booking
  fares scanned from Susan's own logged-in browser, under a
  `scanoffers-` prefix in the same store), `watch.mjs` (Blobs-backed
  watched-trips store), and `watch-check.mjs` (daily scheduled re-search
  of watched trips). Scoring itself still runs client-side in `app.js`
  against live offers only — the seeded-RNG modeled fallback was deleted
  2026-07-26 (see above) — the Functions supply data, not scoring.
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

### The watcher spends quota on a schedule — cap is a spend decision

2026-07-26 (current state, reversing the 2026-07-20 decision at Susan's
direct request): `watch.mjs` caps watched trips at 3 and
`watch-check.mjs` re-searches each at most once per day (~90
searches/month at the cap, against the real 100/month free tier — see
the quota-math comment at the top of watch.mjs for the exact accounting;
that leaves only ~10/month of headroom for manual runs — tight, and the
trade Susan chose knowingly). The cap was briefly lowered to 2
(2026-07-20 → 2026-07-26: ~60/month for the watcher, ~40/month
headroom) before being raised back to 3. Raising the cap further, adding
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
the six-dimension scoring math itself (radical simplicity: this
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

## 2026-07-26 — radical-simplicity pass (MANGO-style, Susan's sign-off)

- **Form**: four essential fields (origin, destination, dates, optimize-for)
  visible; every other control lives in `<details id="refine">` ("Refine —
  airports, travelers, cabin, airlines, budget, wallet"). The open/closed
  state persists in `localStorage["ti-refine-open"]`. All field IDs are
  unchanged — `collectInputs()` was not touched. When testing visibility of
  folded fields use `checkVisibility()`, not `offsetParent` (closed
  `<details>` hides content via content-visibility, so offsetParent lies).
- **Fonts**: self-hosted in `/fonts` (Fraunces variable latin-full
  normal+italic, from the official Fontsource releases); the Google Fonts
  link tags are gone and `netlify.toml` serves `/fonts/*` immutable for a
  year. Rendering verified headless with zero external requests.
- **Link-outs**: every alternatives row links out (Google Flights always,
  aa.com deep link on American rows, Kayak deep link on Kayak-scanned rows
  via `scanSourceUrl()`). Booking.com flight deep links were tested live in
  Susan's browser in three formats and none prefill (their bot-challenge
  strips the route) — Booking-scanned rows deliberately fall back to the
  Google Flights link. Never ship an unverified deep-link format.
- **Tests**: 65 green (app 48, fares 12, scan 5) — the old model-mode tests
  now exercise the live path; new tests pin the `noLiveData` contract and
  the offers-all-filtered case.

## Editorial standard

Editorial standard for external-facing docs: see ~/Projects/project-hub/EDITORIAL_STYLE.md (added 2026-07-28). Also re-verify dimension/Function counts against app.js when touching docs; they drift.

## 2026-07-29 — serif swap: Instrument Serif to Lora

Portfolio-wide taste call: Lora replaces Instrument Serif everywhere
--serif is used, including the two direct 'Instrument Serif' refs in
style.css (.watched-route-main, .watched-price-amount). Self-hosted
(fonts/lora-latin-400-normal.woff2 + -italic.woff2); 404.html's separate
Google Fonts CDN link just got the family name swapped.

## 2026-07-30 — Via/stopover routing wired to the live search

"Put back the Via field" (Susan: "sfo > bangkok via osaka") turned out to
need more than restoring UI — the field was already there, collapsed in
Refine, but `fetchLiveOffers()` hard-blocked any search with a via city
rather than reintroduce the synthetic-model path deleted in the
radical-simplicity pass (see the 2026-07-26 note above). Fixed by using a
REAL multi-city search instead of modeling one: SerpApi's Google Flights
engine already supports multi-city itineraries natively (`type=3`,
`multi_city_json`), so via-routing stays on the same "live feed or honest
no-data" rule as everything else here.

- `netlify/functions/fares.mjs` (v3): a `legs` query param (JSON array of
  2-4 `{origin, destination, date}` legs) switches the handler onto a
  multi-city SerpApi call instead of the single origin/destination/depart/
  return path. `parseLegs()` (new, pure, exported) validates IATA codes,
  dates, and non-decreasing chronology. Offer mapping is factored into a
  shared `mapOffers()` so the two paths can never map offers differently.
  Cached the same way as single-route searches, under its own
  `buildLegsCacheKey()` so the two cache namespaces can't collide.
- `index.html`: added a "Nights at the stopover" number field next to Via
  (multi-city needs a date for the via->destination leg; there was no
  existing input for that). `fetchLiveOffers()` now composes real legs —
  origin->via, via->destination (departure date + stopover nights), and,
  if a return date is set, destination->origin as a third leg — instead of
  refusing the search. New `FALLBACK_REASONS` entries (`unknown-via`,
  `via-bad-request`) replace the old blanket "not wired up yet" message.
- `routeContext()`/`buildLiveCandidates()` in app.js needed no changes —
  they already computed real via-routing geometry for the modeled path;
  that same logic now backs the live path's distance-scaled figures too.

Tests: 30 new handler-level checks (mocked SerpApi + Blobs, covering both
paths unchanged/changed behavior, bad legs, no key, cache hit, a 3-leg
via+return itinerary) plus 16 new `parseLegs`/`buildLegsCacheKey` unit
tests now in `tests/fares.test.mjs` (28 total there, up from 12), plus 7
new checks against the actual `fetchLiveOffers()`/`addDaysIso()` source
verifying real via-search request composition. Full existing suite (`npm
test`) still green at 81 total (48 + 28 + 5). All run before this was
committed, per standing instruction.

## 2026-07-31 — Via field promoted to main form + security audit fixes

- The Via/stopover field (wired to the live multi-city search 2026-07-30)
  was still sitting inside the collapsed `<details class="refine">`
  section from the 2026-07-26 radical-simplicity pass, which predates it —
  live but easy to miss. Promoted `viaCity`/`viaNights` into the main
  `#optimize` form grid, between Destination and Departure date. Refine
  now covers preferred airports, travelers, cabin, airlines, budget,
  wallet.
- `renderWatched(t)`: `t.origin`/`t.destination`/`t.cabin`/`t.id` went
  into the row template unescaped. `netlify/functions/watch.mjs` confirmed
  `origin`/`destination` are raw user strings (capped at 60 chars, never
  escaped server-side) — the real vector; `id`/`cabin` turned out to
  already be validated/allowlisted server-side, so escaping them
  client-side too is defense-in-depth, not a real gap closed. Escaped all
  four with `escapeHtml()`, and replaced the unwatch button's
  `onclick="tiUnwatch('${t.id}')"` (vulnerable to a double-decode trap:
  HTML-escaping quotes in an attribute doesn't protect the JS string
  literal the browser re-parses after decoding it) with a `data-watch-id`
  attribute plus one delegated click listener on `#watching-list`.
- `fetchScanOffers(inputs)`: escaped at the point scan offers enter the
  data model (the trust boundary), not at every downstream render site —
  avoids a double-encoding bug from escaping in both places.
  `netlify/functions/scan-offers.mjs`'s `sanitizeScan()` allowlists
  `source` but never escapes `carrier` (capped at 60 chars only) — that
  was the real vector.
- Committed `ac252c3`. All 81 pre-existing tests plus 4 new ad hoc XSS
  checks green before commit, per standing instruction.

## 2026-08-05/06 — Concert Radar (Vinyl Scout) integration, and the CORS bug that broke it twice

Phase 10, drafted 2026-08-04, built 2026-08-05: this repo's half of a
bidirectional integration with Vinyl Scout's Concert Radar. `GET
/api/watched-trips` (`netlify/functions/watched-trips.mjs`) exposes ONLY
destination city + lat/lon + date range per watched trip — deliberately
never `originIata`, cabin, travelers, baseline price, or the nightly
`checks` history, per this repo's existing privacy-scoping commitment.
lat/lon come from `netlify/functions/lib/city-coords.mjs`, a duplicate of
`app.js`'s own `CITY_COORDS` kept in sync by a dedicated test (see below).
The reverse direction — this site asking "which of my watched trips'
artists are touring nearby" — calls Vinyl Scout's `/api/artists-playing`
from `checkConcertMatches()`.

**Incident #2 (2026-08-05, shipped same day):** the first version of
`watched-trips.mjs` loaded `app.js`'s `CITY_COORDS` at runtime via
`createRequire("../../app.js")`. Passed every local test and `node
--check`, then 502'd in production, because Netlify's function bundler
only packages files reachable through static imports — a dynamic require
to a path outside the function's own directory tree is invisible to it.
Fixed by moving the table into `netlify/functions/lib/city-coords.mjs` as
a real static import, with `tests/watched-trips.test.mjs` cross-checking
it against `app.js`'s own copy (loaded via the same `createRequire` trick,
safe in a Node test process, just not in the deployed function) so the
two could never silently drift apart — or so the plan was; see below.

**Incident #4 (2026-08-06) — the second CORS bug (real), plus two "bugs" that turned out not to be (see the correction below):**

Susan reported "no change to either page" after the Vinyl Scout side's
CORS bug (`artists-playing.mjs` missing `Access-Control-Allow-Origin`,
fixed and shipped as `80f6f51` in vinyl-scout-repo) was already live. A
Chrome DevTools Console screenshot of `vinylscout.org/concert-radar.html`
showed the mirror-image bug on THIS repo's endpoint: `Access to fetch at
'https://travelintelligence.org/api/watched-trips' from origin
'https://vinylscout.org' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested
resource.` Nobody had traced through that `watched-trips.mjs` is called
cross-origin TWO separate ways: this site's own `checkConcertMatches()`
(same-origin, no CORS needed — this is the path every prior test and
manual check exercised) and Vinyl Scout's `concert-radar.html` fetching
the URL directly from `vinylscout.org` (a real cross-origin browser call
that was never covered). `json()` only ever set `Content-Type`/
`Cache-Control` — so every same-origin/tool/curl-equivalent check kept
returning a correct 200 (the exact same false-negative pattern that hid
the Vinyl Scout bug), while the one real cross-site caller silently got
nothing, with no visible error on either site's own UI. Fixed the same
way as the other repo: `export var ALLOWED_ORIGIN =
"https://vinylscout.org"`, set as `Access-Control-Allow-Origin` (plus
`Vary: Origin`) on every `Response` `json()` returns, including the 405
path.

**Correction, same night, after a comprehensive re-verification pass:**
the session that fixed the CORS bug above also reported two more "bugs" —
that `tests/watched-trips.test.mjs`'s sync-check test was broken (silently
diffing against an empty `{}` because `window.TravelIntel` never exposed
`CITY_COORDS`), that `app.js`'s `CITY_COORDS` table was 102 keys behind
`lib/city-coords.mjs`'s, and that `package.json`'s `test` script was
missing `watch.test.mjs`/`watched-trips.test.mjs`. **All three claims were
false.** The tool used to read files from Susan's disk that session
returned stale, cached content for `app.js` and `package.json` — genuinely
old versions from before Incident #3 ever shipped — without any error or
warning that the read was stale. Diffed directly against git history to
confirm: as of commit `6f6147a` (Incident #3's fix, 2026-08-05, already
live before that night's session even started), `app.js`'s
`CITY_COORDS` already had all 349 keys including `ord`/Chicago,
`window.TravelIntel` already exposed `CITY_COORDS`, the sync-check test
was already doing its real job, and `package.json`'s `test` script already
ran all five test files. None of it needed fixing. The one small residue:
a comment wrongly describing this false "102-key gap" got added to
`app.js` before the mistake was caught — removed the same night, no data
or logic in `app.js` actually changed (the `CITY_COORDS` block was
reformatted to match `lib/city-coords.mjs`'s layout, byte-for-byte
functionally identical to what was already there — confirmed via a direct
key-by-key diff against git history, not just a test-suite pass).

**What was real, confirmed independently of the tool that produced the
false claims above:** the CORS bug itself. Susan's own Chrome DevTools
Console, screen-shared live, showed the actual production error before
any fix; the `Access-Control-Allow-Origin` header was verifiably absent
from `watched-trips.mjs`'s `json()` helper in git history all the way
back through every prior commit; and after the fix, the same live
DevTools check showed the error gone. That diagnosis and fix stand as
described above — only the two "bonus" findings from the same session
were spurious.

**Lesson, added to this doc's own list of failure classes:** a tool
reporting success (a stage/read operation returning a plausible mtime and
byte count) is not the same as that tool returning current data. When a
"bug" is discovered by reading a file rather than by an external,
independently-verifiable signal (a real error message, a live screenshot,
a deploy record), diff the claim against git history before writing it
down as fact — especially before adding a comment to source claiming a
bug that isn't real. Ironically, this is the same "claimed fixed but
didn't land" failure class this doc already warns about, just running in
the opposite direction: fixing a bug that was never there in the first
place, because the read reporting it was itself untrustworthy.

**Verified before shipping the CORS fix and confirming the above:**
`node --check` on all changed files; full local suite green at 131/131
(`app.test.js` 48, `fares.test.mjs` 49, `scan.test.mjs` 5, `watch.test.mjs`
19, `watched-trips.test.mjs` 10 — the one genuinely new test being the
CORS-header assertion on `watched-trips.mjs`'s 405 response, mirroring the
pattern already used in vinyl-scout-repo's
`scripts/test-artists-playing.mjs`), run against files whose byte counts
were cross-checked directly against `git show HEAD:<path>` output before
trusting the test run.

**Lesson (same one as the Vinyl Scout side, worth repeating because it
bit twice in one integration):** a cross-origin endpoint can return a
perfectly correct 200 to literally every verification method except the
one that matters — another origin's browser JS reading the response —
because `Access-Control-Allow-Origin` is enforced by the browser on the
reading side, not the server on the serving side. Any new endpoint
intended to be called cross-origin needs its CORS header set (and
regression-tested against the actual `Response` object, not just a live
manual check) from the day it ships, on every code path including
errors — not bolted on after a silent failure report.

## 2026-08-06 — Concert Radar match links + weekly server-side check (Susan, direct request)

Live-verified via a real browser round trip (Claude-in-Chrome, both sites)
before this pass: Ziggy Marley's real Hunter Pavilion show (manually
entered into Concert Radar's Watching card, since SeatGeek doesn't index
that venue) already surfaced correctly on this site's Watched Trips card —
"🎵 2 artists you follow are playing nearby while you're there: Ziggy
Marley, Santigold." That confirmed Incident #4's CORS fix and the whole
feature are genuinely live. Susan then asked for two follow-ups:

**1. Artist names now link to Concert Radar.** `index.html`'s
`checkConcertMatches()` gained `concertRadarLink(artistName, cityName)` —
wraps each name in an `<a href="https://vinylscout.org/concert-radar.html
?artist=...&city=...">`. Artist names come from an external API (SeatGeek,
via `artists-playing.mjs`), so the href value goes through
`encodeURIComponent` (URL-safe) and the visible text still goes through
`escapeHtml` (HTML-safe) — same stored-XSS discipline already applied to
every other server-sourced string in this file. `style.css` already had a
`.concert-match a` rule from the original Phase 10 pass (color: inherit,
underlined) — it just had nothing to style until now.

**2. Weekly server-side check for new matches — did not already exist,
built today.** `checkConcertMatches()` is real but 100% client-side,
fire-and-forget, on-page-visit-only: if Susan never reopens either site, a
newly announced show is never surfaced. New scheduled function
`netlify/functions/concert-match-check.mjs` (Monday 12:00 UTC, same
`watched-trips` store read-only, separate `concert-match-log` store for
its own state) sweeps every non-departed watched trip against Vinyl
Scout's `/api/artists-playing` — the exact endpoint the live client-side
check already calls — and records a `firstSeenAt` timestamp per artist,
per trip. `watched-trips.mjs`'s GET now merges in a `newMatches` array per
trip (artists first seen in the most recent sweep), best-effort — a
missing/failed read there degrades to an empty array, never breaks the
endpoint's core job. `checkConcertMatches()` badges any artist in that
list "🆕 new this week" so a month-old match doesn't read as freshly
discovered every visit.

No email/push, on purpose — `watch.mjs`'s own header comment already
states the standing decision for this whole project ("email/push would
need a new credential and is deliberately not wired"). The delta surfaces
the next time Susan opens either site, exactly the same pattern
`watch-check.mjs` already established for fare-price deltas.

Pure logic (`computeMatchUpdate`, `matchKey`, `resolveTripCoords` in the
new function; the `newMatchesById`-aware `buildWatchedTripsView` in
`watched-trips.mjs`) is fully unit-tested — 14 new assertions in
`tests/concert-match-check.test.mjs`, 4 new + 2 updated in
`tests/watched-trips.test.mjs` (the old exact-key-set privacy assertion
now expects `newMatches` too). Both suites run clean in isolation
(28/28) and wired into `npm test`. `node --check` passes on both touched
`.mjs` files and on the extracted inline `<script>` block from `index.html`.

**Not yet live-verified:** the scheduled function itself (no way to
trigger a Netlify scheduled function or inspect Blobs from this session —
same standing limitation as `watch-check.mjs`'s own daily job). Will only
be confirmed once Monday 12:00 UTC actually runs and Susan sees a "new
this week" badge on a genuinely new match, or reports she doesn't.

## 2026-08-06, later same day — concert-match banner: instant-paint cache + loading state (Susan: "improve it" + "keep it cached until the next check?")

Susan flagged that the match banner looked absent for several seconds on
page load (a screenshot showed the Chicago trip with no banner and "first
check runs tonight" — the banner does exist, `checkConcertMatches()` just
hadn't resolved its two chained cross-site fetches yet when she captured
it) and asked whether the result should be cached so it "loads properly"
on arrival instead of appearing to be broken.

**Two changes to `checkConcertMatches()` in `index.html`, both scoped to
this device's own `localStorage` (key `ti-concert-match-cache-v1`) — no
server-side storage involved, this is a single-user site with no
cross-device sync need:**

1. **Stale-while-revalidate instant paint.** On every call, before the
   live fetch chain even starts, any previously-cached match for that
   trip id is painted immediately (`paintMatchNote`). The live check
   still always runs afterward and is still the sole source of truth —
   this is NOT "trust the cache until the weekly scheduled check runs
   instead of checking live" (Susan's literal phrasing left that
   ambiguous) — the weekly `concert-match-check.mjs` only ever fed the
   "🆕 new this week" badge, not the base match list itself, and that
   didn't change here. The cache exists purely to cover the paint gap
   before the always-still-running live check resolves.
2. **Loading placeholder when there's nothing to paint yet** (first-ever
   visit, or a trip with no prior match) — `.concert-match-loading`, "🎵
   Checking for concert matches…", literal `#6b7080` per the existing
   2026-08-05 contrast-sweep finding that `var(--ink-faint)` only clears
   4.5:1 AA on this row's `--card` background specifically (reusing that
   proven-safe literal, not introducing a new one).

**Failure handling, the part actually worth calling out:** a live check
that fails (offline, a CORS hiccup, Vinyl Scout down) leaves whatever's
currently shown untouched — a cached match stays up, a loading
placeholder quietly clears back to nothing (never left spinning forever).
Only a live check that genuinely *completes* is allowed to write, update,
or clear the cache; a failed check is not treated as evidence a show got
cancelled. `paintMatchNote`/`paintLoadingNote` both route through a
shared `clearMatchNote()` so there's never a duplicate note regardless of
call order — this also let the old "skip if a `.concert-match` already
exists" duplicate-guard be removed, since it would have incorrectly
blocked the live result from ever replacing the cache-paint.

No explicit cache expiry — deliberately kept simple. The live check
already runs on every page load and, when it succeeds, always overwrites
or clears the entry; the only way stale data lingers is a genuinely
offline/broken live check, which is exactly the case the cache exists to
paper over gracefully rather than show nothing.

Verified: `node --check` on the extracted inline `<script>` block passes.
Not yet browser-verified against the live site as of this write-up (no
unit tests cover this — it's DOM/localStorage-dependent browser code,
consistent with how the rest of `checkConcertMatches` has always been
treated in this file).

## 2026-08-07 — CI goes real (GitHub Actions catches a genuinely missing feature), the preference-scoring build, and a live-only alliance bug

This site's GitHub Actions workflow ran for real for the first time this
session (part of a portfolio-wide push to make all four sibling repos more
agentic/GitHub-based — see the `github-agentic-architecture-review`
project doc) and immediately went red, for the right reason: `npm ci`
requires a committed `package-lock.json`, which this repo never had (it
had been running purely on `device_bash`/manual `npm install`, no real
lockfile discipline). Regenerating one via a real `npm install` on Node
20 (no `EBADENGINE` warnings) fixed the install step, but the test step
then failed for a second, unrelated reason: `tests/app.test.js` asserts
against `parseHourFromApiTime`, `departTimeBucket`, `arriveTimeBucket`,
`levenshtein`, `fuzzyMatchKey`, and `suggestCities` — none of which
existed in `app.js`. The tests had been written ahead of the
implementation (an "audit backlog," per the test file's own
2026-08-05-dated comment) and nothing had ever actually run them end to
end against a real Node process until CI did. Confirmed this wasn't a
stale-copy artifact by running the identical test file against the
original, unmodified `app.js` in isolation — it failed at the same
missing-function boundary, proving the gap was already real and had been
sitting unbuilt in the deployed site for at least two days.

**Built to close the gap, all against the existing test spec rather than
inventing a new one:**

- `parseHourFromApiTime`, `departTimeBucket`, `arriveTimeBucket` — regex-
  parse SerpApi's `"YYYY-MM-DD HH:MM"` time strings into an hour, then
  bucket into Early morning (5–7) / Morning (8–11) / Afternoon (12–16) /
  Evening (17–20) / Red-eye (departures, 21:00–04:59) or Late night
  (arrivals, same window) — malformed or missing input returns `null`
  rather than throwing, so a single bad offer can't take down scoring for
  the whole result set.
- Four new Comfort bonuses in `buildLiveCandidates` — preferred airline
  (`PREFERRED_AIRLINE_BONUS = 10`, substring match against
  `inputs.preferredAirlines`), preferred alliance (`PREFERRED_ALLIANCE_
  BONUS = 6`, via the existing `fuzzyAlliance()`), preferred departure
  and arrival time window (`PREFERRED_TIME_BONUS = 8` each, bucket-string
  equality) — all additive, all gated on the offer actually carrying the
  relevant field, and each one only fires an insight line in
  `buildInsights` when it actually applied to the winning offer, so the
  results panel never claims a preference mattered when it didn't move
  the pick.
- `maxStops` filter — collected on the input form for a while but never
  actually applied to the offer pipeline; `buildLiveCandidates` now drops
  any offer whose stop count exceeds it before scoring, confirmed as a
  real pre-existing bug (not something today's changes introduced) by
  running the untouched original `app.js` against the same test and
  watching it fail even earlier, at the missing-function boundary above.
- Typo-tolerant city/country search — `levenshtein()` (Damerau-Levenshtein
  restricted to adjacent transpositions, so `"pairs"` → `"paris"` costs 1)
  and `fuzzyMatchKey()`, used as a last-resort layer in `toIATA()` after
  the exact and whole-word matches, only triggered on a 4+ character
  query with a single unique closest key. `suggestCities()` (new,
  exported) tiers results exact → prefix → fuzzy, city before country,
  primary airport before secondary.
- Multi-airport metro support — `METRO_AIRPORTS` (New York, Washington,
  Chicago, London, Paris, Tokyo, Bangkok) with a derived `ALT_AIRPORT_
  IATA` alias table, checked in `toIATA()` before the whole-word
  fallback, so e.g. a Tokyo search can resolve to either NRT or HND
  depending on which one the free-typed text actually named.

Verified: full local suite green, 73/73 in `app.test.js` alone, 174/174
across all six test files in `npm test` (installing the missing
`@netlify/blobs` dependency first — `watch.test.mjs` needs it and it
wasn't in `node_modules` in the sandbox). Delivered to disk, committed by
Susan as `c689f05`, confirmed green on GitHub Actions (run #3, 25s).

**Same-day CI fixes on the two sibling repos, for the record since they
share this repo's Actions setup pattern:** Streaming Scout was missing a
lockfile in the same way (`7a0df79`, straightforward `npm install`
regeneration, no code changes needed). Vinyl Scout's `npm ci` failed for
a different reason entirely — `jsdom@30.0.1` requires Node `^22.14.0 ||
>=24.0.0` and its workflow was still pinned to Node 20, which doesn't
even install, let alone run, that dependency. Rather than downgrade
jsdom for no functional reason, bumped the workflow's `node-version` to
`'22'` (`b299b47`) — matching what both Susan's Mac and this cloud
sandbox already run, confirmed via `netlify.toml` that nothing else in
either stack is pinned to Node 20. All three repos' Actions runs
confirmed green the same day.

**Per Susan's standing instruction as of this session — after any major
update, run a comprehensive end-to-end test against the live production
site, not just the unit suite, and update docs on both sides (this file,
and any user-facing page like `roadmap.html`) before considering the
work done.** First application of that practice, immediately useful: a
live SF→Tokyo optimization run via Claude-in-Chrome against the real
deployed site turned up a bug no unit test had caught. Susan's own saved
wallet has "Oneworld" checked as a preferred alliance; the live results
table showed a real JAL flight tagged `Unaligned` instead of `Oneworld`,
meaning `PREFERRED_ALLIANCE_BONUS` silently never applied to it. Root
cause: `fuzzyAlliance()` matches against the literal strings in
`ALLIANCES`, and Oneworld's entry only listed `"Japan Airlines"` — but
live SerpApi/Google Flights data returns the carrier as the bare string
`"JAL"`. The unit tests all passed because none of their fixtures used
that exact carrier string; only a real live search surfaced it. Fixed by
adding `"JAL"` as an explicit synonym to Oneworld's carrier list in
`ALLIANCES`, matching the pattern already used elsewhere in this file
(`ASIAN_CARRIERS` already lists both "Japan Airlines" and "JAL").
Verified with a direct `node -e` check against the fixed table and a full
73/73 rerun of `app.test.js`. Delivered to disk; **not yet committed by
Susan as of this write-up.**

**Doc side of the same pass:** `roadmap.html`'s Phase 7 copy claimed the
preferred-airline/alliance/time-window feature had been live since
"(2026-08-05)" — checked against this file's own history and found no
corresponding entry for that date, and against `app.js`'s actual state
before today, which confirmed the feature simply didn't exist in code
until this entry. The date was a leftover from when the test spec was
written ahead of the implementation (see above) and never corrected once
the gap closed. Fixed to read "(2026-08-07)," the date the feature
actually shipped — this file and that page should never disagree about
when something became real.

**Lesson for this doc's own running list:** a test file committed ahead
of its implementation is a legitimate way to spec work, but it's a
liability the moment CI isn't actually wired up to run it — nothing
forces the gap to close, and a live site can silently ship for days
missing functionality its own test suite already fully describes. Now
that Actions runs on every push, this specific failure class (spec
without implementation, undetected) should not recur here; worth
checking whether the same drift exists in Streaming Scout's or Vinyl
Scout's own backlog-style test comments.

**Correction, later the same day — this wasn't "spec never implemented."
It was built, shipped, and then silently deleted, twice, and this doc's
own record of that got deleted along with it.** Git archaeology (`git
log`/`git show` against specific commits — read-only, no working-tree
risk) turned up what the entry above missed: `parseHourFromApiTime` and
the rest of the preference-scoring feature were NOT new. They were
written and pushed to `main` on 2026-08-05 as commit `84053d4`, briefly
lost the same afternoon to an unrelated accidental revert, and restored
within the hour as commit `25ff40d` ("Fix: restore preferred-fields
scoring + contrast-accessibility work that a prior delivery accidentally
reverted") — confirmed live in `app.js` at that commit (`git show
25ff40d:app.js | grep parseHourFromApiTime` returns 4 hits). It then
survived one more commit (`6f6147a`, the CITY_COORDS fix) still intact.

**The real loss happened at `f227f39`** ("Fix: mirror CORS bug on
watched-trips.mjs, repair broken sync-check test, merge missing
CITY_COORDS entries into app.js, wire remaining tests into npm test," Aug
5, 19:55) — a commit whose own message describes a CORS fix and a
CITY_COORDS merge, nothing about preference scoring. Its diff tells a
different story: `app.js` changed by 406 lines, overwhelmingly deletions,
and **this very file, CLAUDE.md, changed by 465 lines, also overwhelmingly
deletions** — including, it turns out, whatever entry once documented the
84053d4/25ff40d build in the first place, which is why grepping this
doc's history for those hashes today turns up nothing. The shape is
consistent with that session working from a stale base copy of both files
(the same device-bridge stale-read failure mode Incident #4's own
"Correction, same night" entry above independently diagnoses, just
striking in the opposite direction here — instead of a stale read
producing a false bug report, a stale base file silently overwrote real,
already-shipped work when it was "merged" back in) — merging the new
CITY_COORDS entries onto an old snapshot of `app.js`/`CLAUDE.md` from
before the preference-scoring feature existed, rather than onto the
current `main`. Nothing in that commit's message or the session that made
it flagged a deletion, because from that session's vantage point (reading
a stale `app.js`) there wasn't one to see.

That regression then sat live in production, completely undetected, for
about a day and a half — through the rest of 2026-08-05, all of 2026-08-06,
and into 2026-08-07 — because nothing was exercising `tests/app.test.js`
against real `main` during that window; the first thing that did was
GitHub Actions, the same day this doc's entry above describes. What this
session rebuilt today isn't new functionality; it's a second restoration
of the same feature `25ff40d` already performed once, this time caught by
an automated gate instead of a person happening to notice, and (via the
JAL/Oneworld fix above) ending up slightly better-tested against live data
than either prior version was.

**Standing lesson, stated plainly because it's now happened twice on this
exact feature:** a "merge missing X into file Y" fix is only as safe as
the base copy of Y being merged into. Before any future commit whose
message includes "merge missing," "restore," or "re-add," diff the
proposed final file against `origin/main`'s actual current version first
(`git show origin/main:<path> | diff - <local copy>`, read-only, no lock
risk) — not just against whatever local snapshot happens to be on disk at
the time — so a stale base can never again silently roll back real,
already-shipped, already-tested work while appearing to only add
something small.

## 2026-08-07, later: Tallinn/stops-filtered fare bug, and Phase 5c (date-range score sweep) shipped

**Bug: a route with real live fares could report "failed or timed out"
when every real offer was filtered out by the user's own Stops setting.**
Found via live E2E testing (SF to Tallinn, 1-stop max) per Susan's
standing instruction to test against the real site after major changes,
not just the unit suite. `runOptimization()` was collapsing two genuinely
different cases into one generic "no data" message: (1) SerpApi actually
returned nothing, and (2) SerpApi returned real offers but the Stops or
Avoid-airline filter removed all of them before scoring. Fixed by
threading two new flags, `stopsFilteredAllOut` and `airlineFilteredAllOut`,
out of `buildLiveCandidates()`/`runOptimization()` so the results panel
can say the true reason ("real fares came back, but all had more stops
than your Stops filter allows") instead of implying the search itself
failed. Delivered as `ea69986`; a same-day hotfix (`1d9238f`) additionally
hid the not-yet-built date-sweep panel so it couldn't be reached before
its function existed (see below). Verified live against the real Tallinn
route post-fix.

**Phase 5c, "date-range score sweep," built end to end.** The panel
existed in the UI already (hidden), but `window.tiRunDateSweep()`, the
function that actually runs it, did not. Built it in `index.html`:
samples up to `SWEEP_MAX_SAMPLES = 6` dates around the last search's
depart/return dates (via the pre-existing `buildSweepDates()` helper in
`app.js`, which widens the interval rather than silently sampling fewer
days than asked when the naive count would exceed the cap), running one
real `fetchLiveOffers()` per sample against the shared `DAILY_SEARCH_CAP`
(20/day) rather than reusing the zero-cost re-score pattern from
`tiReoptimize`/`tiRelaxStopsAndRescore`/`tiRelaxAvoidAndRescore`. A date
sweep genuinely needs fresh live data per date, so this one spends real
quota and is capped hard at 6 samples/click to protect it. Renders a
simple bar chart (`sweepRowHtml`/`renderSweepResults`), stars the
cheapest date(s), and reuses this same entry's `stopsFilteredAllOut`/
`airlineFilteredAllOut` flags for honest per-row "why no data" messaging
instead of a generic empty state. Styled in `style.css`
(`.sweep-chart`/`.sweep-row`/etc.). Verified via `node --check`, the full
195/195 `npm test` suite (unchanged; the new code is UI-layer, no jsdom
harness exists for it here, so verified instead via a standalone
`new Function()` extraction of the actual shipped function bodies against
three real scenarios), and a genuine live E2E round-trip via Claude-in-
Chrome against travelintelligence.org (SFO to Tokyo, 6 real samples,
prices $1,282 to $1,807, correct tie-starring). Delivered to disk and
committed by Susan as `8e31c71`. `roadmap.html`'s Phase 5c card flipped
from Future to Live in the same pass, describing the real per-sample cost
honestly.

**Still open as of this entry:** Phase 7a (loyalty balance integration)
is live in the sense that the UI exists, but has not been independently
spot-checked against a real funded loyalty balance. Phase 8 (server-side
write-auth gate on `watch.mjs`, currently client-only) remains
undelivered; `watch.mjs` is still version 3 with no `checkWriteAuth()`.
Full narrative for both the Tallinn fix and Phase 5c lives in the
`travel-intelligence-build-log.md` project doc.

## 2026-08-07, end of day: session pause; roadmap.html edit not yet committed

Susan is stepping away for the day. State at pause, verified directly via
`git rev-parse`/`git log`/`git diff --stat` (read-only, no lock risk)
rather than assumed: `index.html`, `style.css`, and this file's Phase 5c
work above are committed and pushed (`8e31c71`, confirmed HEAD equals
origin/main). `roadmap.html`'s Phase 5c status flip (Future to Live) is
correctly on disk but **not yet committed**, a one-file, ~20-line diff.
Next session (or Susan directly) should run:

```
git add roadmap.html CLAUDE.md
git commit -m "Flip Phase 5c to Live on roadmap; document Tallinn fix + Phase 5c build"
git push
```

(bundling this CLAUDE.md update into the same commit since it's also
uncommitted as of this pause). No other uncommitted work exists in this
repo at pause time.

**Standing writing-style rule, added 2026-08-07 per Susan's direct
correction: never use an em dash in anything written for her, chat,
docs, code comments, or user-facing copy, full stop.** See
`claude/standing-rules.md` (project doc) for the canonical statement of
this rule going forward.

## 2026-08-08 — second content-drift check: about.html's dimension/priority counts vs. app.js

Extending the pattern built for Streaming Scout the same day (an automated check that fails CI if page copy drifts from the real data/code). Susan picked this as the first of several "slow, one at a time" follow-ons to the GitHub architecture review, explicitly deferring recommendation 1 (direct Claude-to-GitHub commits, still blocked on credential handling — no write-capable GitHub connector exists yet; confirmed by checking the official read-only GitHub integration and the MCP connector registry, neither offers a write path).

`about.html`'s stat strip claims "7 scored dimensions" and "7 weighted priorities" — both hand-typed numbers describing `app.js`'s own `DIMENSIONS` array and `PRIORITY_WEIGHTS` object. Nothing enforced them staying in sync. New `scripts/check-content-drift.mjs` parses both directly out of `app.js` via regex (no eval, no module import of the whole app) and compares against the stat tiles.

Verified both failure modes before shipping: temporarily set the "scored dimensions" tile to 9, confirmed the check fails with a clear message and the right numbers; restored and reconfirmed a clean pass. Wired into `package.json`'s `test` script and added the same weekly `schedule:` cron trigger streaming-scout got, so it also catches drift on weeks with zero code changes.

Local `npm test` couldn't be run end-to-end during this build — `node_modules` was missing, and the `npm install` needed to fix that got cut off by this session's 45-second command timeout, leaving a partial install (`@netlify/blobs` present as an empty directory). This is a local-environment artifact, not a bug in the new check, which was verified standalone (both the pass and the two failure modes above) and via a plain JSON/text read of `package.json` and the workflow file. CI runs a full `npm ci` with no such timeout, so that's the real gate — confirm green after pushing.

## 2026-08-08 — doc alignment pass: about.html and guide.html undercounted the backend

Per Susan's "check review align and update as needed all the roadmaps, guides and about pages" request. Found one real drift: both `about.html` and `guide.html` still said "four small functions," describing only `fares`, `watch`, `watch-check`, and `scan-offers` — but `watched-trips.mjs` and `concert-match-check.mjs` (both built 2026-08-05/06 for the Concert Radar integration) were never folded into that count or description. Fixed both pages to say six and describe all six. `roadmap.html` was already accurate (checked, no change needed there beyond the headline edit from earlier the same day). Verified the "13 loyalty balances" and "7 scored dimensions / 7 weighted priorities" claims against the real form markup and `app.js` — both still correct, no change needed.

## 2026-08-08, later — Phase 8 closed: server-side write-auth gate on watch.mjs

Per Susan's "start with #1" (the first item on the prioritized tomorrow-punchlist: the biggest gap between what the UI implies is protected and what actually is). `watch.mjs` reaches v4: POST/DELETE now run through the same `checkWriteAuth()` / `X-Edit-Key` / `EDIT_SECRET` gate `vinyl-scout-repo`'s `wishlist.mjs` (v4, 2026-08-06) already uses. GET stays public, matching the roadmap card's own stated scope, browsing watched trips and running the optimizer were never the risk; watch/unwatch spending a metered daily search on a shared, open store was.

Client side needed no changes: `index.html` has sent an `X-Edit-Key` header on both the watch POST and the unwatch DELETE since 2026-08-07 (`getEditSecret()`/`clearEditSecret()`, localStorage-backed, already handles a 401 by clearing the stored key and prompting retry). Until this version the server ignored that header entirely, so anyone with the site URL could add or remove watched trips regardless of whether they had the key. That's now closed.

Confirmed before writing anything: `watch-check.mjs` (the daily scheduled re-search) and `watched-trips.mjs` (the read-only Concert Radar cross-check endpoint) both access the Blobs store directly via `getStore(...)`, never through this HTTP handler, so neither is affected by the new gate.

New `tests/watch-auth.test.mjs` (10 assertions), same pattern as vinyl-scout-repo's `scripts/test-wishlist.mjs`: imports the handler directly with real `Request` objects, tests the unauthorized paths only (no-key POST/DELETE, wrong-key POST/DELETE, fails-closed with `EDIT_SECRET` unset, 401 body is real JSON, GET is never rejected by the gate) since those never touch `getStore()` and so run cleanly in a bare Node process with no Netlify Blobs environment configured, same "never mock Blobs" convention this repo already follows. Wired into `package.json`'s `test` script.

**Verified for real, not just asserted:** Susan's Mac has a partial/broken local `node_modules` (`@netlify/blobs` present as an empty directory, a known local-environment artifact from an `npm install` that hit `device_bash`'s 45-second ceiling — documented earlier in this file and in the project build log). Rather than skip verification, staged every relevant file (all test files, all touched `netlify/functions/*.mjs`, `app.js`, `about.html`, `package.json`) into the cloud sandbox, ran a real `npm install` there (full network access, no timeout ceiling), and ran the complete `npm test` chain: **206 total assertions, 0 failures** across `app.test.js` (90), `fares.test.mjs` (49), `scan.test.mjs` (5), `watch.test.mjs` (19, unchanged, confirming the pure decision-logic exports weren't touched), the new `watch-auth.test.mjs` (10), `watched-trips.test.mjs` (14), `concert-match-check.test.mjs` (14), and the content-drift check. `node --check` also passed clean on `watch.mjs` and the new test file.

**A second, unrelated undercount bug found and fixed in `about.html` while touching this file for the roadmap-status update:** the "This site, today" bullet list (a *separate* location from the "Six small pieces of server code" paragraph fixed in the 2026-08-08 doc-alignment pass) still said "four small server functions" — that earlier pass fixed the paragraph mention but missed this second, independent mention of the same number in the same file. Fixed to six, and added a new bullet describing the edit-key gate. Worth remembering: a content-drift fix to one instance of a repeated fact doesn't guarantee every instance was caught, grep for the specific stale text next time, not just the one sentence already known to contain it.

`roadmap.html`'s Phase 8 card flipped `phase--future`/"Future" to `phase--live`/"Live", description rewritten to state plainly that the edit-key gate is now server-enforced, not just a client-side prompt.

**Delivered:** `netlify/functions/watch.mjs`, `tests/watch-auth.test.mjs` (new), `package.json`, `roadmap.html`, `about.html`, this file. Susan needs to set a real `EDIT_SECRET` value in Netlify's environment variables (same variable `wishlist.mjs`/`records.mjs` already use in the sibling repo, so if she's already set one there for a *different* site this is a separate per-site env var, not shared across repos) before this gate actually rejects anything in production, otherwise it fails closed as designed (every write gets a 401) rather than failing open, but the site's own edit-key prompt will never produce a working key until the env var is set to match what she enters. **Flagging this clearly so it doesn't get missed:** check Netlify's Site settings, Environment variables for `travel-intelligence-susan` right after deploying, and set `EDIT_SECRET` to whatever passphrase she wants to use as the watch/unwatch edit key.

Still open, unchanged: Phase 7a (loyalty balance integration) still not independently spot-checked against a real funded balance.
