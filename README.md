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
- A deterministic scoring engine (`app.js`) — six dimensions (Cost,
  Comfort, Upgrade Potential, Award Value, Flexibility, Risk), weighted by
  your priority choice, computed entirely in the browser.
- Miles-or-cash pricing on every candidate: an estimated miles+fees price
  alongside cash, with a pay-with recommendation that flips at the
  1.6¢/mile bar, plus a sort-by control to view the shortlist by price,
  miles value, comfort, upgrade potential, stops, or time.
- Every output section from the original agent brief: Executive Summary,
  Best Recommendation, Top Five Alternatives, Upgrade Strategy (now seven
  concrete tactics — bid sizing, bid windows, check-in counter-offers,
  miles+copay, creative plays), Award Strategy, Purchase Strategy, Travel
  Advisor Insights.
- A Points Intelligence panel answering "which airline's points are worth
  the most" and "what are my transfer options": TPG's monthly valuations
  and active transfer bonuses, hand-copied with their as-of date shown
  (July 2026 currently), wallet-aware so your own cards are flagged.

- A live-fare backend (`netlify/functions/fares.mjs`): an Amadeus Flight
  Offers proxy the frontend queries on every run, scoring real prices
  through the same engine. Activates automatically once
  `AMADEUS_CLIENT_ID`/`AMADEUS_CLIENT_SECRET` are set in Netlify env
  vars; until then the site states it's in demo mode and uses the model.

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
```

## Deploy

Static site, no backend. Push to the GitHub repo (once connected) and
Netlify auto-deploys, matching the other two sites' pipeline. Until that's
connected, deploy directly via Netlify's dashboard or CLI against this
directory.
