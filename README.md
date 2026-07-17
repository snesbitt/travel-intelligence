# Travel Scout

Personal Travel Optimization Agent for Susan. Not a flight search tool —
optimizes the whole travel decision (cost, comfort, upgrade potential,
award value, flexibility, risk) against a ranked list of what actually
matters on a given trip.

Sibling project to [The Fitness Log](https://thefitnesslog.org) and
[The Streaming Scout](https://streamingscout.org) — same house style, same
phased-roadmap discipline, same "label every number for what it is" ethic.

## What's real today (Phase 1)

- The full Input Card: trip, flight preferences, ranked optimization
  priority, credit cards, 13 airline loyalty programs, 7 hotel programs,
  airport flexibility.
- A deterministic scoring engine (`app.js`) — six dimensions (Cost,
  Comfort, Upgrade Potential, Award Value, Flexibility, Risk), weighted by
  your priority ranking, computed entirely in the browser.
- Every output section from the original agent brief: Executive Summary,
  Best Recommendation, Top Five Alternatives, Upgrade Strategy, Award
  Strategy, Purchase Strategy, Travel Advisor Insights.

## What's not real yet (see `roadmap.html`)

There is no live fare or award search. Prices and mileage figures are
computed from hand-maintained reference ranges, not fetched from Google
Flights, ITA Matrix, seats.aero, or any airline system. The homepage says
this directly in a banner, and `guide.html` explains exactly which numbers
are computed vs. referenced. Wiring in real data sources is Phase 2.

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
