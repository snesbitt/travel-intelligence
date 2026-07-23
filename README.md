# Travel Intelligence

Personal Travel Optimization Agent for Susan. Not a flight search tool —
optimizes the whole travel decision (cost, comfort, upgrade potential,
award value, flexibility, risk) against a ranked list of what actually
matters on a given trip.

Sibling project to [The Fitness Log](https://thefitnesslog.org), [The
Streaming Scout](https://streamingscout.org), and Vinyl Scout — same house
style, same phased-roadmap discipline, same "label every number for what it
is" ethic. Meant to hold the same bar as the other three: a flagship
example of what an agentic build looks like, not a one-off demo.

## What's real today (Phase 1)

- The full Input Card: trip, flight preferences, optimization priority
  (primary + optional secondary dropdown), credit cards, 13 airline
  loyalty programs, airport flexibility. (Hotel loyalty programs were
  removed for now — see roadmap.html.)
- A saved wallet: credit cards and loyalty balances persist in the
  browser (localStorage) and reload automatically — update the figures
  as they change and re-save.
- Saved preferences & trip memory: cabin, stops, preferred/avoided
  airlines, alliances, times, airports to avoid, preferred seat/hotel,
  typical travel style, and a logged upgrade-wins history all persist the
  same way the wallet does — a saved travel style nudges the suggested
  optimization lens (only when the trip's own signals don't already pick
  one), and the insights check the saved airport/upgrade-win lists
  against each result.
- A deterministic scoring engine (`app.js`) — six dimensions (Cost,
  Comfort, Upgrade Potential, Award Value, Flexibility, Risk), weighted by
  your priority choice, computed entirely in the browser.
- Miles-or-cash pricing on every candidate: an estimated miles+fees price
  alongside cash, with a pay-with recommendation that flips at the
  1.6¢/mile bar, plus a sort-by control to view the shortlist by price,
  miles value, comfort, upgrade potential, stops, or time.
- Every output section from the original agent brief: Executive Summary,
  Best Recommendation, Top Five Alternatives, Upgrade Strategy, Award
  Strategy, Purchase Strategy, Travel Advisor Insights — each with
  do-this-now actions and live links, not descriptions.
- An Economy → Business playbook: when booking Economy (the default),
  the Upgrade Strategy prices the three real routes to Business for the
  specific trip — the Premium Economy ladder, the direct bid (20–40% of
  the computed fare gap), and miles + copay checked against your saved
  balances — then runs a dated timeline from booking day to the gate.
- Trip-aware priority suggestions: a transparent rule set reads the
  route distance, cabin, budget-vs-typical-fare, purpose, and saved miles
  and recommends the two best optimization lenses with its reasoning —
  one-click Apply, never an override.
- Via/stopover routing (e.g. SFO → Osaka → Bangkok) on real two-leg
  great-circle geometry, a travelers stepper with per-person and total
  pricing, and a results-level "Optimize for" filter plus sort-by control
  that re-rank instantly without re-running.
- Collapsible density: long cards (13 loyalty programs, 18 TPG valuation
  rows, the 9-step upgrade timeline) open collapsed to their high-signal
  rows with explicit "Show all N" toggles.
- The fare watcher: "Watch this trip" saves a route (max 2, stored in
  Netlify Blobs via `/api/watch`); a scheduled function
  (`watch-check.mjs`, daily 14:00 UTC) re-searches each watched trip —
  one live search per trip per day, ~60/month at the cap — and the
  homepage Watched Trips card shows the live fare floor with day-over-day
  deltas. Alerts are in-app; email/push would need a new credential and
  is deliberately unwired.
- Upgrade plan → calendar: one click exports the dated upgrade timeline
  (bid deadline, seat-map check, check-in, gate ask) as an `.ics` file.
- Booking handoffs: the winning itinerary links directly to the
  carrier's own site ("Book on United ↗") for 18 known carriers.
- Offline shell: a service worker caches the pages and engine so the
  installed PWA opens without a connection (API calls are never cached —
  live stays live or fails honestly).
- A Points Intelligence panel answering "which airline's points are worth
  the most" and "what are my transfer options": TPG's monthly valuations
  and active transfer bonuses, hand-copied with their as-of date shown
  (July 2026 currently), wallet-aware so your own cards are flagged.

- A live-fare backend (`netlify/functions/fares.mjs`): a Google Flights
  proxy (via SerpApi) the frontend queries on every run, scoring real
  prices through the same engine. Activates automatically once
  `SERPAPI_KEY` is set in Netlify env vars; until then the site states
  it's in demo mode and uses the model. (Amadeus Self-Service was the
  original provider; that portal was decommissioned 2026-07-17.)

## What's not real yet (see `roadmap.html`)

Award-space search. Mileage figures in both modes are distance-scaled
planning ranges, not a seats.aero-style availability check — the UI says
so wherever they appear. In demo mode (no API credential yet), fares too
are modeled from hand-maintained, distance-scaled reference ranges; the
banner and results header always state which mode produced the numbers.

## Repository layout

- `index.html` — the optimizer: Input Card + results, all client-side.
- `app.js` — the scoring engine. Pure functions, no DOM code — see the
  comments at the top of the file for exactly what's computed vs.
  hand-maintained reference data.
- `style.css` — shared house style (matches the sibling sites' palette
  pattern: cream/serif shell, persistent nav, phase/step page templates).
- `about.html`, `guide.html`, `roadmap.html` — public explainer pages,
  same convention as the sibling sites.
- `netlify.toml`, `manifest.json`, `icons/` — static deploy config + PWA
  install support.

## Local development

No build step. Serve the directory and open it:

```bash
npm run dev     # serves on :8888
npm test        # runs tests/app.test.js (scoring functions) and tests/fares.test.mjs (fare cache/TTL)
```

## Deploy

Push to main on github.com/snesbitt/travel-intelligence and Netlify
auto-deploys — static pages plus the three Functions (`fares`, `watch`,
`watch-check`). `SERPAPI_KEY` lives in Netlify env vars; without it the
site runs in labeled demo mode.
