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
- Backend: six live Netlify Functions, not static-only (updated
  2026-08-08; was four as of the original build, then five once
  `watched-trips.mjs` shipped 2026-08-05, then six once
  `concert-match-check.mjs` shipped 2026-08-06, see below) —
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
  to cross-check against), and `concert-match-check.mjs` (weekly
  scheduled sweep flagging newly matching Concert Radar shows on
  already-watched trips). Scoring itself still runs client-side in
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
- Never hardcode secrets: the one credential (`SERPAPI_KEY`) lives in
  Netlify env vars, and `EDIT_SECRET` (the watch/unwatch write-auth gate,
  added 2026-08-08) works the same way; any future key goes the same
  route, never in source.
- **Radical simplicity wins** (Susan's standing rule, 2026-07-19).
  Simple beats complicated-and-bloated for this project, every time. The
  backend stays six single-file Functions and one blob store; a new
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

No build step; six single-file Functions ride along with the static
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

## 2026-08-08, later still: Phase 7a spot-check found and fixed a real cross-alliance bug in the balance check

Per Susan's "move on and i'll take the above on shortly" (proceeding to the next punchlist item, Phase 7a, while she handles Phase 8's `EDIT_SECRET` step at her own pace). Task was to independently verify Phase 7a ("Loyalty balance integration") against a real funded balance, per the standing note in this file that it was "live in the sense that the UI exists, but has not been independently spot-checked."

Reading `awardRecommendation()` in `app.js` before running anything turned up a real bug rather than just a verification gap. The function's own header comment describes `loyaltyBalanceCheck` as checking "her actual saved balance, in a program that flies this itinerary's alliance," but `relevantPrograms` was built as `programBalances.filter((p) => p.balance > 0)`, with no alliance check at all. `buildInsights()` elsewhere in the same file already does the correct filter, via `programMatchesAlliance()`, for its own cross-alliance warning insight; `awardRecommendation` just never called it.

Concrete failure mode, confirmed by hand before fixing anything: a wallet with Delta SkyMiles (SkyTeam) at 90,000 miles and Turkish Miles&Smiles (Star Alliance) at 20,000, against a Star Alliance itinerary (United), returned Delta as the "relevant" program and reported the balance as "enough, covers this itinerary, 65,000 miles to spare," a confident, specific, wrong claim, since Delta doesn't fly Star Alliance redemptions. The correct program (Turkish, 20,000, short by 5,000) never surfaced at all.

Fixed by filtering `relevantPrograms` through the same `programMatchesAlliance(p.program, alliance)` check `buildInsights` already uses:
```js
const relevantPrograms = programBalances.filter((p) => p.balance > 0 && programMatchesAlliance(p.program, alliance));
```
`index.html`'s rendering needed no changes: its copy ("Add a balance above if you hold miles in a program that flies this alliance...") already described the intended behavior; only the underlying data was wrong.

Two new regression tests in `tests/app.test.js` pin this: one confirming an out-of-alliance balance never appears in `relevantPrograms` or drives a false "enough" verdict, one confirming that with both an out-of-alliance and an in-alliance balance in the same wallet, only the in-alliance one is picked, even though it's smaller. Both fail against the pre-fix code (confirmed before applying the fix, not assumed) and pass after.

**Verified for real:** staged the fixed `app.js` and updated `tests/app.test.js` alongside every other test file, all touched Netlify Functions, and `package.json`/`package-lock.json` into the cloud sandbox, ran a genuine `npm install` (full network access) and the complete `npm test` chain: **203 assertions, 0 failures**, across `app.test.js` (92, up from 90), `fares.test.mjs` (49), `scan.test.mjs` (5), `watch.test.mjs` (19), `watch-auth.test.mjs` (10), `watched-trips.test.mjs` (14), `concert-match-check.test.mjs` (14), plus the content-drift check passing clean.

`roadmap.html`'s Phase 7a card flipped from `phase--future`/"Future" to `phase--live`/"Live", description updated to state plainly that a balance outside the itinerary's alliance is never counted, even if it's bigger, matching what the code now actually does.

**Known adjacent gap, not fixed here, flagged for later:** `programMatchesAlliance`'s internal alliance map has no entry for Etihad ("Unaligned" in the top-level `ALLIANCES` table doesn't include it either, and neither map lists it under any alliance), so an Etihad Guest balance can never be reported as "relevant" to any itinerary even though it's a real option in the wallet UI and in `POINT_VALUATIONS.airlines`. Low-frequency edge case (one specific program), left alone rather than scope-creeping this fix; worth a one-line addition whenever Etihad comes up for real.

**Delivered:** `app.js`, `tests/app.test.js`, `roadmap.html`, this file. Nothing committed or pushed; per this project's standing workflow, Susan runs `git add`/`commit`/`push` herself.

## 2026-08-08, later still: Etihad alliance gap closed, and a full em-dash sweep across the whole codebase

Susan said "yeah go for it all" after the doc-review pass, picking up the two items flagged as adjacent gaps: the Etihad alliance-map gap noted just above, and the 54 em dashes previously flagged in `index.html` and left for a careful pass.

**Etihad gap closed.** Both alliance maps were missing Etihad: the top-level `ALLIANCES` table's `Unaligned` entry, and `programMatchesAlliance`'s own internal map. Added `"Etihad Airways"` to `ALLIANCES.Unaligned` and `"Etihad"` to `programMatchesAlliance`'s `Unaligned` list, matching the existing Alaska/Emirates/JetBlue pattern. New regression test in `tests/app.test.js` confirms an Etihad Guest balance is now recognized as relevant to an Unaligned itinerary.

**Em-dash sweep, expanded well past the 54 in `index.html` once the rest of the codebase was checked.** `app.js` had 75, `style.css` had 15, and every test file and Netlify Function had more (`fares.mjs` alone had 35), all missed by the earlier doc-only pass since that one only checked the public-facing pages. Categorized every instance before touching anything: user-facing text (form hints, button labels, alert text, the Award Strategy card's insight sentences, a handful of API error messages returned to the frontend on failed watch/unwatch/fare-search calls) got a real sentence rewrite, not a mechanical swap. Internal code comments and test descriptions (the overwhelming majority) got a comma or colon substituted for the dash, since these are read by future sessions and Susan when reading code, not rendered to any UI. Placeholder characters used for missing values (an em dash shown when a time/price/carrier is null) were switched to an en dash (`"–"`), a different character already used elsewhere in this codebase for numeric ranges, so the "empty" visual convention survives without violating the em-dash rule.

One mechanical bug caught and fixed during the sweep: the first pass used a regex that matched across line breaks, which silently merged a few multi-line comments onto one line and left a stray `//` sitting as literal text mid-sentence. Caught by grepping for `, //` after the fact and confirmed there were exactly 4 instances, all in `app.js`; fixed by hand, restoring the original two-line structure.

Every file in the repo now has zero em dashes: `index.html`, `app.js`, `style.css`, all seven test files, all seven Netlify Functions plus `lib/city-coords.mjs`, and `scripts/check-content-drift.mjs`. Verified with a repo-wide grep after the sweep, not just spot-checked.

**Verified for real:** staged every touched file into the cloud sandbox, ran a genuine `npm install` and the full `npm test` chain there: 204 assertions, 0 failures, across `app.test.js` (93, up from 92), `fares.test.mjs` (49), `scan.test.mjs` (5), `watch.test.mjs` (19), `watch-auth.test.mjs` (10), `watched-trips.test.mjs` (14), `concert-match-check.test.mjs` (14), plus the content-drift check passing clean. `node --check` passed on every touched `.js`/`.mjs` file, and the inline `<script>` block extracted from `index.html` parses clean too.

**Delivered:** `app.js`, `index.html`, `style.css`, `tests/app.test.js`, `tests/concert-match-check.test.mjs`, `tests/fares.test.mjs`, `tests/scan.test.mjs`, `tests/watch-auth.test.mjs`, `tests/watch.test.mjs`, `tests/watched-trips.test.mjs`, `netlify/functions/concert-match-check.mjs`, `netlify/functions/fares.mjs`, `netlify/functions/scan-offers.mjs`, `netlify/functions/watch-check.mjs`, `netlify/functions/watch.mjs`, `netlify/functions/watched-trips.mjs`, `netlify/functions/lib/city-coords.mjs`, `scripts/check-content-drift.mjs`, this file. Nothing committed or pushed; per this project's standing workflow, Susan runs `git add`/`commit`/`push` herself.

## 2026-08-11: watched trips sorted soonest to latest; cap raised to 6, re-search cadence stretched to every-other-day

Susan asked directly: "make sure the watched trips are ordered from soonest to latest and accommodate up to 6 watched itineraries." Two genuinely separate changes, one a straightforward UI fix, one a real quota tradeoff.

**Ordering:** `renderWatched()` in `index.html` never sorted `trips` before rendering, whatever order the Blobs store returned them in is what showed up. Fixed by sorting once, by `departDate` (a validated `YYYY-MM-DD` string, safe to compare lexicographically without `Date` parsing), right before the render pass, so every call site (initial load, a new watch, an unwatch) picks up the ordering automatically. `checkConcertMatches()`'s call site was updated to match for consistency, though it looks up rows by ID, not position, so order never actually mattered there.

**Cap, the real tradeoff:** raising `MAX_TRIPS` from 3 to 6 without changing anything else would have pushed `watch-check.mjs`'s daily re-search from ~90 SerpApi searches/month (today's real spend, documented in `watch.mjs`'s own quota-math comment) to ~180/month, blowing straight through the 100/month free-tier quota. Flagged this to Susan before touching anything, per the standing rule in that same comment that this exact tradeoff is hers to make, not the agent's. Recommended, and she chose, stretching the re-search cadence to every-other-day instead of raising spend: 6 trips at that cadence lands back at ~90/month, matching today's budget almost exactly, at the cost of watched-price data being up to ~48h stale instead of ~24h.

**Implementation, three files:**
1. `watch.mjs`: `MAX_TRIPS` 3 to 6, quota-math header comment rewritten with the new accounting and the reversibility note (drop the cap back down, or revert the cadence, either is a one-line change, per this file's own established pattern).
2. `watch-check.mjs`: `MAX_TRIPS` kept in sync at 6, and the per-trip re-search threshold changed from 20h to 44h (the cron itself stays daily at 14:00 UTC, the threshold is what actually produces the every-other-day cadence per trip). Header comment and version bumped to reflect both changes.
3. `index.html`: the watched-trip sparkline's tooltip said "N nightly checks", no longer accurate at every-other-day cadence, changed to "N checks".

**Verified, each step independent:** every edit applied via an anchor-and-verify script (abort on anything but an exact single match, caught one of my own typos this way, `let` vs. the file's actual `const`, before it could touch anything wrong). `git diff` reviewed in full before either commit. Both commits pushed (`c6277c5` for the ordering fix, `6471c5f` for the cap and cadence), and both confirmed actually deployed via Netlify's own deploy record (`commit_ref` matching exactly), not just pushed.

**Delivered, and already committed and pushed, unlike this file's usual pattern:** `index.html`, `netlify/functions/watch.mjs`, `netlify/functions/watch-check.mjs`. Both commits above are already on `origin/main` and confirmed live. This CLAUDE.md entry itself is the one piece still pending; Susan commits and pushes it herself per the standing workflow.

## 2026-08-11, later: watch.test.mjs's CAP_DESTS fixture never got updated when MAX_TRIPS changed, found and fixed, full suite reverified

The `6471c5f`/`c6277c5` commits above were pushed without running this repo's own `npm test` chain first, a real miss against this file's own established practice (every prior entry here confirms tests were run before delivering). Caught after the fact, not guessed: `tests/watch.test.mjs` has a deliberate self-check assert, `CAP_DESTS.length` must equal `MAX_TRIPS`, and `CAP_DESTS` was still hardcoded to the old cap of 3 while `MAX_TRIPS` had already moved to 6. The suite aborted on that assertion before finishing, not a real product bug, a stale test fixture.

One unrelated environment issue found and cleared along the way: `node_modules/@netlify/blobs` was silently empty locally (a broken or partial install, not a repo problem). `rm -rf node_modules package-lock.json && npm install` fixed it and let the suite actually run to completion for the first time this session.

Fixed: `CAP_DESTS` in `tests/watch.test.mjs` extended from three entries (`AAA`, `BBB`, `CCC`) to six (`AAA` through `FFF`), matching the new cap. `watch-auth.test.mjs` does not reference `MAX_TRIPS` at all, nothing to fix there.

Verified for real: full `npm test` rerun locally after the fix, every suite green, ending on the content-drift check passing clean.

Delivered and committed together in this same commit: `tests/watch.test.mjs`, this changelog entry.

## 2026-08-11, later still: open-jaw support (return from a different city than you flew into)

Susan's request: search and watch a trip like "SFO to VFA, home from BBK to SFO" (fly into one city, out of a different one, e.g. an overland safari leg between Victoria Falls and Kasane). Not previously possible: every prior search assumed the return leg departed from the same city the outbound leg landed in.

**No backend search change needed.** `fares.mjs`'s `legs` multi-city path (added 2026-07-30 for via/stopover routing) was already generic: `parseLegs` never required a leg's destination to match the next leg's origin, so a real 2-leg open-jaw itinerary was already expressible, it just had no caller that built one. This is the same "one honest real feature, exercised two ways" shape as the via-routing addition itself.

**Optimize form (`index.html`, one-off searches).** A new optional field, "Return from a different city (open-jaw, optional)", composes with the existing via/stopover field: `fetchLiveOffers` now builds a `legs` request whenever either field is set, with the return leg's origin swapped to the open-jaw city when present. Validated the same "live feed or honest no-data" way as everything else here: an unrecognized return-from city or a missing return date (open-jaw only makes sense paired with one) fails loudly with a specific reason string (`unknown-return-from`, `return-from-needs-date`), never silently ignored. Route display strings (the rec-hero card, the .ics upgrade-plan export) now show `... (returns from X)` when set.

**Watched trips (`watch.mjs`, `watch-check.mjs`).** Trips can now store an optional `returnFromIata`/`returnFromCity`, validated server-side (`validateTripInput`: must be a real 3-letter code, and only accepted alongside a real `returnDate`, same reasoning as the frontend guard). `buildWatchId` now includes `returnFromIata` in its tuple, same non-breaking-migration approach the 2026-08-05 returnDate/travelers addition used: no existing stored trip's id is ever recomputed, only new watches made after this ships get the 7th field, and the only transition cost is a route watched before vs. after this change won't dedupe against itself (correct direction to fail in). `watch-check.mjs` gained `isOpenJaw`/`buildMultiCitySearchParams`, a real 2-leg `type=3` multi-city re-search for open-jaw trips; the existing `buildSearchParams` (round-trip/one-way) is untouched and still used for every non-open-jaw trip, so none of its existing test assertions changed meaning. `pickCheapestOffer` needed no change, it already works on any SerpApi response shape.

**Booking deep links, deliberately conservative.** `liveSearchUrls`'s Google Flights link now describes the real open-jaw itinerary in its natural-language query ("Flights from SFO to VFA on ..., returning BBK to SFO on ..."), same honest-best-effort tier the plain Google Flights link already was. The American Airlines `aa.com` deep link is deliberately NOT attempted for open-jaw trips: its "MultiCity" slices shape was never verified live the way the existing OneWay/RoundTrip shapes were, and this file's own standing rule is to never ship an unverified URL; falls back to `carrierSite()` or the Google Flights link instead. `scanSourceUrl`'s Kayak deep link is skipped the same way, for the same reason.

Test coverage added: `tests/watch.test.mjs` (open-jaw `validateTripInput`/`buildWatchId` cases), `tests/watch-check.test.mjs` (`isOpenJaw`, `buildMultiCitySearchParams`), `tests/app.test.js` (`liveSearchUrls`/`scanSourceUrl` open-jaw behavior). Full `npm test` green after every change (added assertions, zero regressions in any existing test). Nothing committed or pushed from this session; Susan applies the patch, reviews the diff, and runs `git add`/`commit`/`push` herself.

---

## 2026-08-21 — Exact-match city fields (roadmap Phase 11)

**Susan:** *"fix the fuzzy matching feature in Travel Intel — when i type in a city
and it matches, i want to be able to click on the suggestion and have it add the
city and airport code to the field to make it an exact match. update and do better"*

### What she asked for
`select()` in index.html's `attachCityAutocomplete` committed `it.value` ("Seattle"),
not `it.label` ("Seattle (SEA)"). One-line ask.

### What the one-line fix would have broken
`toIATA` had no notion of a trailing code. Its whole-word fallback matched the city
name and discarded the parenthesised code, so committing the label would have
silently searched the WRONG airport for every non-primary one:

| committed value | resolved to (before) | correct |
|---|---|---|
| `Paris (ORY)` | CDG | ORY |
| `New York (LGA)` | JFK | LGA |
| `London (LGW)` | LHR | LGW |
| `Chicago (MDW)` | ORD | MDW |
| `Washington (DCA)` | IAD | DCA |

A wrong airport presented as an exact match is the same class of failure as the
synthetic fares removed in Phase 9 — a guess wearing a real value's clothes.

### What actually shipped
1. **`parseIataSuffix` / `stripIataSuffix`** (app.js). A trailing `(XXX)` is a
   literal code, checked in `toIATA` immediately after the bare-3-letter rule and
   **above every fuzzy layer**. Exact by construction, not by luck.
2. **`select()` commits `it.label`** (index.html).
3. **`IATA_DISPLAY` extended from `METRO_AIRPORTS`.** Built from `CITY_IATA` alone,
   which is one code per metro, so secondary codes had no display name and rendered
   as a bare "ORY" in results, watched trips, and calendar exports. Invisible while
   toIATA still collapsed them; making the suffix authoritative is what exposed it.
4. **`suggestCities` matches airport NAME as well as metro key.** Two bugs at once:
   refocusing a field committed to a secondary airport returned zero rows (strip
   leaves "Paris–Orly", which is not a key), and airport names were entirely
   unsearchable — "orly", "laguardia", "midway", "gatwick" all found nothing.
   Token-prefix matched at word starts so short fragments don't match mid-word.
5. **`close()` clears `list.innerHTML`**, so a hidden list holds no stale rows.

### How it was verified
`npm test` — 107 in app.test.js (up from 97), full suite green, content-drift clean.
Then a **headless browser pass** driving the real DOM: click-commit, keyboard-commit,
secondary-airport pick, refocus, and typo path.

**The refocus bug was found only in the browser.** The unit test used
`"Seattle (SEA)"`, which strips to `"Seattle"` and matches a key, so it passed while
the real case was broken. Lesson: for anything the autocomplete commits, test a
SECONDARY airport, not just a primary — they take different code paths. Both are now
covered in tests/app.test.js.

### Untouched, and confirmed so by test
Typo tolerance (`bankok` → BKK), country lookups (`Estonia` → TLL), whole-word
matching (`greenville, south carolina` → GSP), and suggestion ranking (`par` → CDG,
never Paraguay/ASU).

## 2026-08-21 — Stopover field defaults

**Susan:** *"change Nights at the stopover to default to 0. also remove the via:
stopover field suggestion just leave it blank (its rarely used)"*

- `#viaNights` `value="1"` → `value="0"`.
- `#viaCity` placeholder `"e.g. Osaka (routes the trip through it)"` removed.

Both are index.html only. Checked before changing: `viaNights` is **not** in
`savePreferences()`'s field list — trip-specific fields deliberately never persist
— so the HTML attribute is the only default and no stale localStorage value can
override it. `collectInputs()` already reads it as
`Math.max(0, parseInt(...) || 0)`, and the leg builder uses
`addDaysIso(departDate, viaStopoverNights || 0)`, so 0 was always a supported
value; it just wasn't the default. A 0-night stopover routes through the city on
the same day rather than overnighting.

The autocomplete stays attached to `#viaCity` — only the placeholder hint went.

## 2026-08-21, later still — expired transfer bonuses rendering as "Active", plus a stale-docs sweep and five new drift checks

Started as a documentation pass and turned up one real data bug first.

### The bug: two dead bonuses printing under "Active transfer bonuses"

Both rows in `TRANSFER_BONUSES` (app.js) carry `ends: "Jul 31, 2026"`. Nothing
anywhere filtered on `ends`, so on 2026-08-21 the Points Intelligence panel was
still printing both under the heading **Active transfer bonuses** — 21 days after
they ended. Same class of failure as the synthetic fares deleted in Phase 9 and the
wrong-airport resolution fixed this morning: a dead value wearing a live one's
clothes.

- `parseBonusEnd()` reads the `"Jul 31, 2026"` shape the table copies verbatim and
  returns the **last instant of that day in UTC** — a bonus ending today is active
  all of today. An unparseable date returns `null` and the row stays visible (a
  typo is a data-entry error, not an expiry); the drift check fails on it so it
  gets fixed rather than silently vanishing.
- `activeTransferBonuses(now, bonuses)` is the filter, both arguments injectable
  for tests. `bestPointsAnswers()` and index.html's `renderPointsIntel()` both go
  through it. **The expired rows are NOT deleted from the table** — the table is
  the record of what was copied and when.
- Empty state, which is what the panel shows today: it says no bonus in the
  hand-copied table is still running, names the date the most recent one ended, and
  says that an empty list means nothing current has been copied in, not that no
  bonus exists. Same rule as the fares: state what is actually known.
- 8 new tests in tests/app.test.js (active renders, expired doesn't, ends-today
  boundary at three times of day plus the day after, mixed list, unparseable kept,
  and the real table against the real clock). 107 → 117 in that file.

### Valuation staleness made self-reporting

`POINT_VALUATIONS.asOf` was prose only ("July 2026 … copied 2026-07-18") against a
stated monthly refresh, so nothing could tell a two-week-old copy from a six-month
one. Added `copiedOn: "2026-07-18"` and `staleAfterDays: 45` (monthly plus two
weeks of slack) and `valuationAge()`. The panel now prints the age next to the
figures, and past 45 days says to read them as indicative. The build-failing half
lives in the drift check, so **this will start failing on 2026-09-02 unless the
table is re-copied from TPG** — that is the point, not a bug. Bump `asOf` and
`copiedOn` together; a test asserts `asOf` contains `copiedOn`.

### Stale user-facing copy fixed

| where | was | now |
|---|---|---|
| roadmap.html Phase 8 | "a metered **daily** search" | "a metered live search **every other day**" |
| watch.mjs cap error | "each costs one live search **per day**" | "…**every other day**" |
| guide.html SVG caption | "the only server calls are the fare search and the watcher" | three lines naming all six functions, including the public `watched-trips` read vinylscout.org consumes, which the caption had omitted entirely |
| about.html stat tile | `6` / "trips watched for you" | `6` / "watched-trip slots" (6 is `MAX_TRIPS`, a cap, never a live count — the real count in data/concert-match-log.json is 2) |
| about.html §04 | "spell out what's computed today versus planned" | every phase is live and nothing is planned; award-space search is named as missing and explicitly *not* a phase |
| about.html §02 | "The one gap left **on the roadmap**" | "The one gap left" — it was never a roadmap item |

**Item 5 judgment call:** the choice was to correct the sentence or add an
award-space roadmap entry. Corrected the sentence. Adding a phase would assert a
commitment to a paid availability source (seats.aero) that Susan has not signed off
on, and the standing rule here is that anything needing a new credential or spend
waits for her explicit yes. Deleting a false claim needs no such approval; making a
promise on the roadmap does.

Also: about.html's "what's on the page" listed 4 sections and omitted 4 live ones —
Watched Trips, My Balances, the Date-Range Score Sweep, and Points Intelligence.
All four added as `page-card`s, in page order. And open-jaw/stopover routing, live
since 2026-07-30 and 2026-08-11, appeared **nowhere** public; described now in §01,
including today's defaults (Via blank, 0 nights) and the honest limit that an
open-jaw carries into a watched trip while a stopover does not.

### Five new checks in scripts/check-content-drift.mjs

It loads app.js the same way the tests do (window stub + `createRequire`), so it
checks real behavior, not just regexes over source:

3. No bonus `activeTransferBonuses()` returns may be past its `ends`; every
   `ends` must parse; index.html must not map `T.TRANSFER_BONUSES` directly again.
4. `POINT_VALUATIONS` age vs `staleAfterDays`, and `asOf` vs `copiedOn`.
5. "N small functions" prose in guide/about/roadmap vs the real
   `netlify/functions/*.mjs` listing (6).
6. **Every cadence word describing a scheduled job**, in all three pages, against
   the real crons. Prose is split into clauses (tags → newlines, then sentence
   punctuation and ", and "-style joins) because one sentence routinely describes
   two different jobs. A clause about the concert sweep must say weekly
   (`0 12 * * 1`); a clause about the fare watcher must match the **44-hour floor
   in watch-check.mjs, not its daily cron** — the check derives "every other day"
   from that floor, so changing the floor changes what the pages are required to
   say. "monthly" is exempted in a clause about the SerpApi quota, which is a real
   monthly number and not a cadence.
7. `MAX_TRIPS` (watch.mjs, source of truth) vs the about.html stat tile and vs
   "capped at N trips" / "holds up to N trips" in prose.

### Verified

`npm test` green — 234 assertions across the suite, drift check clean. Each of the
five new checks was then **deliberately broken one at a time and confirmed to fail
with a message that names the fix** (roadmap back to "daily", concert sweep called
"daily", function count set to five, tile set to 3, render path reverted to the raw
table, `copiedOn` pushed 90 days back, and the filter's comparison neutered), then
restored and the suite re-run.

### One correction to the brief that prompted this

Commit `040b799` ("Fix stale docs: fare-watching cadence…") touched **about.html
only**, not guide.html. guide.html's prose was already correct by other means; the
only thing wrong in it was the SVG caption, which that commit could not have missed
because it never opened the file.

## 2026-08-21 (later still) — deploy-freshness check

Added portfolio-wide after vinylscout.org was found serving a **2026-08-14**
deploy, 8 days stale. Cause: `locked: true` on the published deploy. Netlify pins
a locked deploy as the live one, so builds run and nothing publishes over them.
Netlify's API said `state: "ready"` the whole time and was correct — that deploy
was ready, it just wasn't the one being served.

What made it invisible: every check across these sites watches whether **data** is
fresh. None watched whether the deployed **site** matches the repo.

`scripts/check-deploy-fresh.mjs` fetches each page in
`scripts/deploy-fresh.config.json` and compares it byte-for-byte with the file on
disk. These sites publish the repo root as-is, so a mismatch means the live site
is not this commit. It reads what a visitor reads rather than asking the API,
because the API answer is what hid this.

Not in `npm test` — that suite is offline by design. `npm run check:deploy`, or
`--wait` to poll for three minutes right after a push.

This site was NOT affected; the check is here so the class of failure is covered
everywhere rather than only where it happened.


## 2026-08-28 — Audit fix pass: bundler gap, missing write-auth, no scheduled
## site checks, no retry, dropped trip history

Implementing a prior read-only audit's findings, in the order it gave them.
Susan approved the exact list before any of this was written. Nothing was
pushed -- per this project's standing workflow, Susan pushes herself; each
item below is its own commit so a later `git bisect` has one traceable cause
per breakage, not a bundle.

**Bundler gap, `watched-trips.mjs`'s committed match-log read.**
`readCommittedMatchLog()` reads `../../data/concert-match-log.json` via
`fs.readFile()` -- a path outside the function's own directory, invisible to
Netlify's bundler, the same failure class this file documents as Incident #2
(city-coords.mjs's own header). Fixed with `included_files` in `netlify.toml`
under `[functions."watched-trips"]`, the standard fix for exactly this. No
existing function used `included_files` yet to pattern-match against; this is
now that precedent.

**`scan-offers.mjs` POST had no write-auth gate.** `watch.mjs`'s v4
(2026-08-08) gated POST/DELETE with `checkWriteAuth()` against
`X-Edit-Key`/`EDIT_SECRET`; `scan-offers.mjs`'s POST was never updated to
match, so anyone with the site URL could pollute the deep-scan feed the
optimizer merges into live results. Applied the identical gate (copied, not
imported -- this repo keeps cross-function sharing in `netlify/functions/
lib/`, and 4 lines didn't earn a new file). New `tests/scan-auth.test.mjs`,
same shape as `tests/watch-auth.test.mjs`, wired into `npm test`.

**No scheduled site-health checks.** `check-deploy-fresh.mjs` existed but was
`npm run check:deploy` only, never run automatically. `test.yml`'s schedule
moved weekly -> daily and now runs three checks on the scheduled trigger only
(never on push/PR, so pushes aren't slowed and PRs don't spam issues):
deploy freshness (existing script, now actually wired in), a new
`scripts/check-integrity.mjs` (read-only; see its own header for exactly
what it can check without a Blobs credential this repo doesn't have and
isn't adding), and a new `scripts/smoke.mjs` (pings each function's safe,
side-effect-free path; skips `watch-check.mjs`/`concert-match-check.mjs`,
both schedule-only with no safe path to ping). Any failure opens or, if one's
already open, comments on a `Scheduled site-health check failed` issue via
the default `GITHUB_TOKEN` -- no new secret, no third-party integration,
per Susan's explicit constraint for this whole pass.

**`concert-match-check.yml` had no alerting of its own.** Same
issue-on-failure pattern, scoped to that job. Separately: the prior audit
flagged that this job's last commit to `data/concert-match-log.json` was
2026-08-17 despite a weekly Monday cron. Unresolved here -- this job only
commits when the match log actually changes, so a legitimate no-diff run and
a silently-skipped run both look identical in `git log`, and this
environment has no GitHub API/`gh` CLI access to check real Actions run
history. Flagging for Susan to check the Actions tab directly.

**No retry/backoff on external calls in either scheduled sweep.**
`watch-check.mjs`'s SerpApi search and `scripts/concert-match-check.mjs`'s
two fetches each did one bare `fetch()`; a transient blip or upstream
5xx/429 silently skipped that trip for a whole cycle. Both now retry (3
attempts, short flat backoff, no new dependency). In fixing this, found and
fixed a related bug in `concert-match-check.mjs`: its 8s per-request timeout
built one `AbortController` OUTSIDE the retry loop and reused its signal
across attempts -- an aborted signal stays aborted, so a timeout on attempt 1
silently killed attempts 2 and 3 too. Moved the timeout inside the retry
helper so each attempt gets its own controller.

**`concert-match-check.mjs` dropped trip history on skip.** The
departed-trip and unmapped-destination branches `continue`d without carrying
`prevAll[trip.id]` into `nextAll`, unlike the fetch-error branch right below
them, which already did this correctly. Both now carry the previous entry
forward unchanged, matching that branch.

**Retiring the old Netlify-scheduled `concert-match-check.mjs`: SKIPPED.**
The prerequisites (the bundler fix, the alerting, the retry fix) are now
code-complete, but nothing above has run in production yet -- Susan hasn't
pushed, and this session has no network path to the live site or to GitHub's
API to watch the new path actually succeed even once. Retiring the only
currently-proven sweep before its replacement has a real production track
record risks losing coverage rather than improving it. Revisit once the new
path has run clean for a few weeks live.

**`CABIN_CLASS` deduplicated.** Was defined identically in `fares.mjs` and
`watch-check.mjs`; extracted to `netlify/functions/lib/cabin-class.mjs`, same
pattern `lib/city-coords.mjs` established. No behavior change, confirmed by
`npm test`.

**`_to_delete/` cleared.** Stale git lock files, two zip backups, an old
`app.js`/`index.html`/`roadmap.html` backup set, and a leftover commit-
message scratch note -- all already-flagged cruft, confirmed nothing in
there looked like real data before deleting.

**Verified:** `npm test` green after every commit above (each was run
individually, not just at the end). `check-integrity.mjs` and `smoke.mjs`
were each exercised against a local mock HTTP server covering every
pass/fail branch (in-process, `process.exit` stubbed, no real process
spawning) since this environment has no network path to the live site to
verify them end-to-end -- the same limitation `check-deploy-fresh.mjs`
already has when run from here. `check-content-drift.mjs`'s new anchor-link
check was verified by deliberately renaming an id, confirming the failure
message, then reverting.
