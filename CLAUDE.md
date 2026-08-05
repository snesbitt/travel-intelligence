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
- 2026-07-31 (Susan: "improve the city fields to better/more elegantly
  handle mispellings with fuzzy matching"): added a third resolution tier —
  exact match, then whole-word match (both above), then a typo-tolerant
  fuzzy match — to `toIATA()` and `lookupCoords()` in `app.js`. New helpers
  `levenshtein()` (optimal-string-alignment edit distance: insert/delete/
  substitute at cost 1, plus adjacent-letter transposition at cost 1, so
  "Pairs"→Paris and "Tokoy"→Tokyo work, not just dropped/wrong letters) and
  `fuzzyMatchKey()` (scans a table, returns the single closest key within
  the distance threshold, or `null` on a tie or no match — never guesses).
  Threshold: 1 typo allowed under 13 characters, 2 at 13+ (longer phrases
  can carry two small slips with less risk of coincidentally resembling an
  unrelated name); inputs under 4 characters never fuzzy-match. Validated
  with an exhaustive sweep (every deletion/substitution/adjacent-swap
  variant of every real `CITY_IATA`/`COUNTRY_TO_IATA` key, ~64k variants)
  confirming zero wrong resolutions — every variant lands back on the same
  key or safely returns unresolved. That sweep is what caught and fixed a
  first-pass bug: a flatter "2 typos above 7 chars" threshold let the
  fictional "Atlantis" resolve to Atlanta (ATL) — a case the test suite
  had already relied on staying unresolved (see
  "unresolved city or missing date produces NO links" in
  `tests/app.test.js`). Both `toIATA()` and `lookupCoords()` check the
  fuzzy layer directly against their own tables (not just via a resolved
  code) so geometry resolves even for names whose IATA code isn't itself a
  `CITY_COORDS` key (e.g. "Chigaco"-style Chicago typos → ORD, which isn't
  a `CITY_COORDS` key on its own — "chicago" is). `FALLBACK_REASONS` copy
  in `index.html` updated from a now-stale "e.g. Bangkok, not Bankok"
  example (that typo resolves correctly now) to "even allowing for a typo
  or two". Tests: `levenshtein()` and `fuzzyMatchKey()` exposed on
  `window.TravelIntel` for `tests/app.test.js`; new tests cover common
  typos, the country-name path, exact-match precedence over fuzzy, refusal
  to guess on no-match/ties, and the exhaustive sweep (a representative
  sample runs in the regular suite; the full ~64k-variant sweep was ad hoc
  validation during the build, not part of `npm test`, to keep it fast).
- 2026-07-31, same session, two follow-ups after Susan tried "Pairs" as a
  destination and asked about the Stops field:
  1. **Live typeahead.** New `suggestCities(query, limit)` in `app.js`,
     exposed on `window.TravelIntel`, returns ranked, deduped-by-code
     suggestions (exact match, then prefix, then whole-word substring, then
     the same typo tolerance `toIATA` uses) — deliberately a separate,
     *more permissive* function than `toIATA`/`fuzzyMatchKey` rather than a
     reuse of either: a typeahead shows several candidates and lets the
     person pick, so it's fine to surface near-misses the silent resolver
     correctly refuses to guess between. `attachCityAutocomplete()` in
     `index.html` wires this to an ARIA 1.2 combobox (role=combobox/
     listbox/option, aria-expanded/aria-activedescendant, full keyboard
     nav, 44px touch rows matching the site's existing target-size
     convention) on origin, destination, viaCity, and preferredAirport.
     Selecting a suggestion always fills the field with a string that
     exact-matches on resolve (verified by test — see
     "every suggested value resolves back to the same code via toIATA").
  2. **The Stops field didn't do anything — a real bug, not just a UX
     gap.** `inputs.maxStops` was collected from a "Maximum stops" select
     (including a "Nonstop only" option) and saved as a preference, but
     `buildLiveCandidates` never read it — stops only ever cost points via
     the Risk/Comfort scores, never excluded an offer. Same "control that
     silently does nothing" bug class as the resolution/scoring gaps this
     file's whole history has caught (SFO→Greenville, Muscat→Chicago,
     etc.) — a UI element that doesn't do what it says is its own kind of
     invented result. Now a real hard filter in `buildLiveCandidates`
     (`stopsLimit = inputs.maxStops == null ? Infinity : inputs.maxStops`,
     so every existing caller that predates this field being wired to
     anything is unaffected). "Nonstop only" with no nonstop offer in the
     live set correctly returns the existing honest `noLiveData` empty
     state (same generic empty-state path avoided-airline filtering to
     zero already used — no new distinct reason string added, matching
     this codebase's radical-simplicity precedent of not over-distinguishing
     *why* zero candidates resulted). The field itself was promoted from
     the "Flight preferences" fold to the main Trip card as a pill-toggle
     (same reasoning Via/stopover was promoted for: "a headline feature,
     not an edge case" — arguably more so for Susan, who said "I always
     want to fly nonstop if available"), default changed to Nonstop only.
     Still persists via the same `savePreferences`/`loadPreferences`
     mechanism as before (`pillVal("maxStops")`/`setPillVal("maxStops", …)`
     replacing the old `document.getElementById("maxStops").value` reads/
     writes) — visually it's on the main card now, behaviorally it's still
     a saved cross-trip preference, not a per-trip field.
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

## 2026-07-31 — Nonstop default wasn't sticking + Paris-only-shows-CDG (Susan: "fix and do better")

- **Multi-airport metros.** `suggestCities`/`suggestAliases` in `app.js`
  deduped strictly by IATA code, and `CITY_IATA` maps each city name to
  exactly ONE primary code by design — so a metro with more than one
  commercial airport (Paris: CDG/Orly/Beauvais) only ever had one alias to
  dedupe from in the first place. Typing "paris" could never surface Orly;
  there was no second alias for it to lose a dedupe race against. Fixed
  with a new `CITY_ALT_AIRPORTS` table (city name → array of its other real
  airports — New York/EWR+LGA, Washington/DCA+BWI, Chicago/MDW, LA/BUR+LGB+
  SNA+ONT, Houston/HOU, Dallas/DAL, SF/OAK+SJC, London/LGW+STN+LTN+LCY,
  Paris/ORY+BVA, Tokyo/NRT, Osaka/ITM, Shanghai/SHA, Beijing/PKX, Seoul/GMP,
  Rome/CIA, Buenos Aires/AEP, Sao Paulo/CGH, Rio/SDU, Bangkok/DMK, Toronto/
  YTZ), consulted only by `suggestAliases()` (suggestions), never by
  `toIATA`/`fuzzyMatchKey` (resolution) — a search still books against
  exactly one deterministic primary code unless the traveler explicitly
  picks a different one from the list. Every alt code got a `CITY_COORDS`
  entry (so distance/flight-time works for whichever one gets picked) and,
  where `IATA_DISPLAY` had no existing entry, a "City–Airport" label (e.g.
  "Paris–Orly (ORY)") so the suggestion reads clearly next to the metro's
  primary. Selecting an alt-airport suggestion has to resolve back to THAT
  airport, not silently downgrade to the metro's primary — "Paris–Orly"
  contains "paris" as a whole word, which would otherwise hit `toIATA`'s
  existing whole-word fallback and return CDG. Added `altAirportNameToCode()`
  (built from the same `CITY_ALT_AIRPORTS`/`IATA_DISPLAY` data, so it can't
  drift from what `suggestCities` actually shows), checked in `toIATA`
  right after the exact-match checks and before the whole-word fallback.
  Typo tolerance benefits too: "bankok" now surfaces both BKK and DMK, same
  as an exact "bangkok" query would.
- **Nonstop default wasn't reliable.** Two separate bugs, both in
  `index.html`: (1) `collectInputs()`'s fallback if no Stops pill read as
  selected was `"3"` (Any stops) — directly contradicting the HTML default
  (Nonstop only has the `sel` class) and the entire point of the filter;
  changed to `"0"`. (2) The real-world cause of what Susan actually saw:
  `maxStops` used to live on a plain `<select>` with no "this is a
  deliberate choice" signal, and any value saved back then (whatever the
  select's own default was) is indistinguishable from an accidental
  leftover — but `loadPreferences()` restored a saved `maxStops`
  unconditionally, silently overriding the new Nonstop-only default for
  anyone with pre-existing saved prefs (confirmed via Claude-in-Chrome: a
  stale `maxStops: "1"` from before today carried forward and beat the new
  default). Fixed with a `maxStopsConfirmed` flag, saved alongside
  `maxStops` and set `true` only by an actual click on the Stops pill row
  (not by cabin changes or other fields' blur events, which also trigger
  `savePreferences`). `loadPreferences()` now only restores a saved
  `maxStops` when `maxStopsConfirmed` is true — pre-existing unconfirmed
  values are left unapplied (page keeps the Nonstop-only HTML default) —
  while a genuine choice, made today or any day after, is still fully
  sticky across trips exactly as the "saved as your default across trips"
  label promises. Verified via Claude-in-Chrome with a simulated stale
  `localStorage` entry: unconfirmed `maxStops: "1"` still loads as Nonstop
  only; clicking "1 stop" once and reloading correctly restores "1 stop".
- `tests/app.test.js`: updated the two `suggestCities` tests whose exact
  counts changed now that multi-airport metros surface more than one row
  (Paris: 1 → 3; "chi" query: +MDW; "bankok" typo: 1 → 2, now includes
  DMK), and added a dedicated test asserting every alt airport across all
  six covered multi-airport metros round-trips through `toIATA` back to
  its OWN code, never a sibling airport in the same metro. 61 tests green
  (up from 60). The `maxStopsConfirmed` migration logic lives entirely in
  `index.html`'s inline script (DOM/localStorage), outside the Node test
  harness's reach (it only loads `app.js`) — verified instead via
  Claude-in-Chrome against a live local server, per the scenario above.
- **Update:** pushed by Susan as commit `093342f` and confirmed live via
  Claude-in-Chrome against the real site — the "not yet pushed" note above
  described a since-resolved in-between state, kept for its own history
  rather than rewritten.

## 2026-08-05 — /api/fares abuse protection (audit backlog item)

`fares.mjs` has no auth (same open-by-design model as `watch.mjs`/
`scan-offers.mjs` — nothing sensitive is stored or returned), which meant
anything that could find the URL could spend the 100-search/month SerpApi
quota: a scraper hitting it directly, another site embedding it, a
shared/indexed link. Two lightweight guards, deliberately not a full
per-IP rate limiter (more infrastructure than this problem needs, per the
radical-simplicity rule):

1. **Origin/Referer allowlist** (`isAllowedOrigin`, exported/pure) —
   rejects a real search request (not the `?ping=1` health check, which
   returns before this runs and costs no quota either way) that didn't
   come from `travelintelligence.org`/`www.travelintelligence.org`/local
   dev. Checked first, before even revealing whether the SerpApi key is
   configured. Not real auth — both headers are spoofable by a determined
   scraper — but it stops the actually-likely case of something hitting
   the bare API URL directly. `netlify.toml`'s `Referrer-Policy:
   strict-origin-when-cross-origin` means a real same-origin `fetch()`
   from `index.html` always sends a full-URL Referer, so the allowlist
   checks Referer's origin as a fallback when Origin itself is absent
   (browsers often omit Origin on same-origin GET fetches).
2. **A daily circuit-breaker cap** (`DAILY_SEARCH_CAP = 20`, shared across
   both the single-route and multi-city search paths) — tracked with the
   same `getWithMetadata`/`onlyIfMatch`/`onlyIfNew` optimistic-concurrency
   retry loop `watch.mjs`'s POST handler already uses, so a burst of
   concurrent requests can't race past it. Only counts real SerpApi calls
   — a 15-minute cache hit returns before the counter is touched, exactly
   like it already returns before hitting SerpApi. Bounds the worst case
   (guard #1 defeated, or a genuine bug loop in Susan's own browser) to
   losing at most one day's headroom, not the whole month. Like
   `MAX_TRIPS` in `watch.mjs`, raising this cap is a quota/spend decision
   — Susan's call, not something to bump without her sign-off.

Both failures return their own `reason` string (`origin_not_allowed` 403,
`daily_cap_reached` 429) rather than folding into the generic
`upstream_error`/`api-fail` bucket — `index.html`'s `fetchLiveOffers()`
maps them to distinct frontend reasons (`origin-blocked`, `daily-cap`)
specifically so they're excluded from the existing one-retry-on-timeout
logic (retrying a deterministic block wastes a round trip and can never
succeed until the cause changes) and get honest copy in `FALLBACK_REASONS`
instead of "the live search failed or timed out; re-run to retry", which
would be false for both.

Tests: 17 new pure-function assertions in `tests/fares.test.mjs`
(`isAllowedOrigin`, `isOverDailyCap`, `todayQuotaKey`) — no
`@netlify/blobs` mocking needed, same pattern the rest of this file's
tests already use. Full suite: 130/130 green (61 app + 45 fares + 5 scan +
19 watch — the last two shipped the same day, see below).

## 2026-08-05 — watch.mjs race condition + returnDate/travelers id bug

Shipped the same day as the abuse-protection work above. Full detail is in
this project's `claude/travel-intelligence-build-log.md`, not duplicated
here — short version: `watch.mjs`'s POST handler had a read-then-write
race on the `MAX_TRIPS` cap (fixed with the same optimistic-concurrency
pattern used for the fares quota cap above), and the watch id silently
dropped `returnDate`/`travelers`, so two watches differing only in those
fields collided as "already watching." 19 new tests in
`tests/watch.test.mjs`.

## 2026-08-05 — wired the six dead preference fields into real scoring (audit backlog item)

`preferredAirlines`, `preferredAlliances`, `preferredDepartTime`,
`preferredArrivalTime`, `carryOnOnly`, and `checkedBags` were all collected
in `collectInputs()` (and the first four saved via `savePreferences()`) but
`buildLiveCandidates` never read any of them — the exact "control that
silently does nothing" bug class this file's whole history has already
caught and fixed (SFO→Greenville, the Stops filter). Split into two
honest treatments rather than forcing all six into fake scoring:

**Four got real Comfort scoring**, same additive-clamp pattern
`ASIA_COMFORT_BONUS` already uses, and the same "announce it in insights,
never a hidden thumb on the scale" rule:

- `PREFERRED_AIRLINE_BONUS` (+8) — a saved preferred airline
  (case-insensitive substring match, same style `avoidAirlines`'s
  exclusion filter already uses) gets a Comfort bump. Soft preference, not
  a filter — Susan said "preferred," not "only," so non-preferred
  airlines still show up, just score slightly lower on this one
  dimension.
- `PREFERRED_ALLIANCE_BONUS` (+5) — matches a saved alliance checkbox
  against `fuzzyAlliance(carrier)`, the same alliance-lookup the
  candidate object already carries.
- `PREFERRED_TIME_BONUS` (+4, applied independently for depart and
  arrival, so up to +8 combined) — required extending `fares.mjs`'s
  `mapOffers()` to pass through each offer's `departTimeRaw`/
  `arriveTimeRaw` (the outbound leg's first-segment departure and
  last-segment arrival, straight from SerpApi's
  `flights[].departure_airport.time` / `.arrival_airport.time`, a
  "YYYY-MM-DD HH:MM" string). `app.js`'s `parseHourFromApiTime()` +
  `departTimeBucket()`/`arriveTimeBucket()` read just the hour and bucket
  it into the same five bands the two `<select>` dropdowns use (bucket
  boundaries: Early morning 5-7, Morning 8-11, Afternoon 12-16, Evening
  17-20, tail 21-4 — labeled "Red-eye" for departure and "Late night" for
  arrival, matching each dropdown's own option text). **Not yet verified
  against a live SerpApi response** — no `SERPAPI_KEY` in this build
  environment, and a real search costs real quota, so the exact
  `departure_airport.time`/`arrival_airport.time` field path is a
  reasonable-confidence read of SerpApi's documented Google Flights
  response shape, not a live-checked one (contrast with `liveSearchUrls()`
  2026-07-24, which WAS verified live before shipping — same standard,
  just not yet met here). Designed to fail safe either way: a wrong or
  missing field just returns `null` and the preference has zero effect,
  same as before this feature existed — it can't invent a wrong bucket or
  show a wrong time. **Next time a real search runs, spot-check one
  offer's `departTimeRaw`/`arriveTimeRaw` in the network response against
  what the results card shows for that flight, and update this note.**

**Two stayed honestly unscored.** `carryOnOnly`/`checkedBags` are still
collected (they're per-trip fields, not saved preferences — see "Saved
preferences & trip memory" below, unchanged) but never touch scoring,
because live offers carry zero baggage-fee or fare-class data to check
them against (`cabins` in `mapOffers()` is always `[]`). Inventing a
bag-fee estimate to score against would be exactly the "invented
specifics" this file's SFO→Greenville incident exists to warn against.
Same treatment as `preferredSeat`/`preferredHotel` already got: the
"Flight preferences" card's intro copy in `index.html` now says plainly
that these two are collected for context, not scored.

Tests: 12 new assertions in `tests/app.test.js` (hour parsing, bucket
boundaries against the exact dropdown option text, isolated single-bonus
checks, a stacking check, a missing-data-degrades-safely check, and an
insight-announcement check) and 4 new assertions in `tests/fares.test.mjs`
for `mapOffers()`'s new `departTimeRaw`/`arriveTimeRaw` fields (multi-segment
uses first/last, single-segment, missing data, missing `flights` array
entirely — none throw). Full suite: 146/146 green (73 app + 49 fares + 5
scan + 19 watch).
## 2026-08-05 — Concert Radar (Vinyl Scout) ↔ Travel Intelligence: built

Susan asked (2026-08-04, a separate unattended Vinyl Scout session) "if
i'm watching a fare like Chicago you check the feeds to see who i am
interested in that is also playing in town during those dates when i'll
be there" — a bidirectional link between this site's Watched Trips and
Vinyl Scout's Concert Radar (vinylscout.org). That session drafted the
full technical plan into Vinyl Scout's `PROJECT.md` (Phase 10) and sent a
standalone copy of this site's own half over, since it didn't have write
access here. The next day, Susan answered the plan's two open questions
(radius = fixed ~25mi; matching scope = full catalog + wishlist + Vinyl
Scout's venue scrape, not just the curated Watching list) and said
"proceed" — this entry is that build.

**This site's half: `netlify/functions/watched-trips.mjs`** (new, `GET
/api/watched-trips`). Reads the same `watched-trips` Blobs store
`watch.mjs` already owns (no new store) and returns, per trip, ONLY
`destination` + `lat`/`lon` + `dateStart`/`dateEnd` — never `originIata`,
`cabin`, `travelers`, `baseline`, or `checks`. This isn't a new privacy
exposure: it's a strict SUBSET of what `watch.mjs`'s own `GET /api/watch`
already returns unauthenticated today. Coordinates come from
`netlify/functions/lib/city-coords.mjs` — see that file's own header
comment and the "same-day production fix" note below for why this is a
real static import and NOT the original design (loading `app.js`'s own
`CITY_COORDS` at runtime via `createRequire`, the technique
`tests/app.test.js` uses to run `app.js` under Node): that version worked
in every local check but 502'd for every real caller once deployed.
`tests/watched-trips.test.mjs` has a dedicated test that loads `app.js`'s
table the old way (safe in a Node test process) and diffs it against
`lib/city-coords.mjs`, so the two copies can't silently drift apart. A
`destIata` with no coordinate entry is reported honestly in
`meta.unmapped` rather than guessed at or dropped. A one-way
trip (no `returnDate`) uses `departDate` for both ends of the window —
this site has no signal for how long a one-way traveler stays, so the
match window is scoped to just the depart day rather than inventing a trip
length. Pure logic (`buildWatchedTripsView`, `loadCityCoords`) exported and
covered by `tests/watched-trips.test.mjs` (8 assertions, including one
that specifically proves the private fields never leak).

**Vinyl Scout's half** (`netlify/functions/artists-playing.mjs`,
`concert-radar.html` v19) is documented in that repo's own `PROJECT.md`
(Phase 10) and `CLAUDE.md` — not repeated here. One design note worth
knowing from this side too: it does NOT sweep the catalog/wishlist per
artist the way Concert Radar's own Coming Soon feature does (that only
scales because it's client-side, fixed-location, and cached for an hour)
— instead it queries SeatGeek by location+date-window with no performer
filter, then cross-references the small in-memory result against the
artist list. A bounded number of calls regardless of catalog size.

**Client wiring:** `renderWatched()` in `index.html` now calls
`checkConcertMatches()` at the end of every render (initial load, a new
watch, an unwatch) — fetches this site's own `/api/watched-trips` for
coordinates, then Vinyl Scout's `/api/artists-playing` per mapped trip,
and appends a green `.concert-match` note (new CSS, `style.css`, reusing
the existing `--good`/`--good-dim` variables) to that trip's row on a real
hit. Entirely best-effort: any failure in the chain (Vinyl Scout down,
CORS, offline) silently leaves the row exactly as it already rendered —
this is a bonus, never a blocker, and the watched-trip's own real fare
data is never gated on it.

**Also fixed in this pass, unrelated bug found along the way:**
`tests/watch.test.mjs` (added 2026-08-05 alongside the 3-trip-cap race fix
and the returnDate/travelers watch-id fix) was never actually wired into
`npm test` — `package.json`'s test script only ran `app.test.js`,
`fares.test.mjs`, and `scan.test.mjs`. Its 19 assertions were passing all
along whenever run directly, just not as part of the standard test command
anyone would actually run before a commit. Fixed: `npm test` now runs
`watch.test.mjs` and the new `watched-trips.test.mjs` too. Full suite: 48
(app) + 49 (fares) + 5 (scan) + 19 (watch) + 8 (watched-trips) = **129
green**, all run before this was committed, per standing instruction.

**Same-day production fix: the first deploy of `/api/watched-trips` 502'd on every call.** Checking the live endpoint after Susan reported not seeing the feature found `travelintelligence.org/api/watched-trips` returning a 502 on every request (`travelintelligence.org/` itself loaded fine — this was scoped to the one function). Root cause: the original `loadCityCoords()` pulled `app.js`'s `CITY_COORDS` table in via `createRequire(import.meta.url)("../../app.js")` — this passed `node --check`, the full local test suite, and manual Node runs, because all of those execute from inside the actual repo, where `../../app.js` really is on disk relative to the function file. Netlify's function bundler (esbuild) packages a function by statically tracing its `import`/`require` graph; a *dynamic* `require()` call to a relative path is invisible to that trace, so `app.js` — which lives outside `netlify/functions/` entirely — never made it into the deployed bundle. Every real invocation threw `Cannot find module '../../app.js'`, caught by Netlify's runtime as an unhandled function error → 502.

Confirmed empirically, not just by reasoning: bundled the original `watched-trips.mjs` with esbuild exactly as Netlify's builder would (`--bundle --platform=node --format=esm --external:@netlify/blobs`), ran the resulting bundle in an isolated directory with no `app.js` present (simulating exactly what ships to production), and reproduced the identical `Cannot find module '../../app.js'` throw. Bundling the fixed version the same way and running it the same way in isolation returns the real coordinate data successfully.

**Fix:** moved the table into `netlify/functions/lib/city-coords.mjs` as a genuine static `export const CITY_COORDS = {...}` (see that file's header) and changed `watched-trips.mjs` to a plain static `import` — the pattern esbuild's tracer does follow. Costs a second copy of the same ~170-entry table (the exact duplication the original design intentionally avoided), guarded against drift by `tests/watched-trips.test.mjs`'s sync-check test (loads `app.js`'s copy the old, test-safe way and diffs every key against the new file). All 9 `watched-trips.test.mjs` assertions and the full 155-test suite (73 app + 49 fares + 5 scan + 19 watch + 9 watched-trips) pass against the fixed code.

**Still not verified:** the two actual deployed sites (`travelintelligence.org` and `vinylscout.org`) talking to each other cross-origin in a real browser. `vinylscout.org` is blocked from this session's WebFetch by its own robots.txt, so Vinyl Scout's `/api/artists-playing` specifically has NOT been checked from here — Susan checked or was asked to check it directly. Worth a real end-to-end pass (open a watched trip near a real upcoming show) once this fix is live.
