// netlify/functions/watched-trips.mjs
// version: 1
// Phase 10 — Concert Radar hooks (2026-08-05). Travel Intelligence's half
// of the bidirectional integration with Vinyl Scout's Concert Radar,
// drafted 2026-08-04 (this repo's CLAUDE.md, "Concert Radar (Vinyl Scout)
// <-> Travel Intelligence" entry) and built the next day after Susan's
// three resolved answers: fixed ~25mi radius, full catalog + wishlist +
// venue-scrape matching scope, and (that day) documentation only — this is
// the actual build.
//
// GET /api/watched-trips
// Returns ONLY destination city + lat/lon + date range per watched trip —
// deliberately never originIata, cabin, travelers, baseline price, or the
// nightly `checks` history. This is the privacy-scoping commitment this
// repo's own CLAUDE.md already documented before this file existed: Vinyl
// Scout's artists-playing.mjs only ever needs to know WHERE and WHEN, never
// fares or points data. Reuses the SAME 'watched-trips' Blobs store
// watch.mjs already owns (read-only here) — no new store, no new write
// path, per this repo's "radical simplicity" rule.
//
// lat/lon come from app.js's own CITY_COORDS table (loaded here via
// createRequire, same technique tests/app.test.js already uses to run
// app.js under Node) rather than a second, hand-duplicated IATA->lat/lon
// table — one source of truth, so the two can't silently drift apart. A
// destIata with no CITY_COORDS entry is honestly reported in
// meta.unmapped rather than guessed at or silently dropped.
//
// One-way trips (no returnDate) report dateStart === dateEnd === departDate
// — an honest simplification: this repo has no signal for how long a
// one-way traveler stays, so the match window is scoped to just the depart
// day rather than guessing a trip length.
//
// PURE READ. Never writes. Not gated — same rationale as the rest of this
// integration's read endpoints: the data exposed (a destination city name
// and travel dates) is materially less sensitive than what watch.mjs
// already returns unauthenticated today (origin/destination/cabin/
// travelers/baseline price), so this isn't a new exposure, it's a strict
// subset of one that already exists.

import { getStore } from "@netlify/blobs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/watched-trips" };

// Loads app.js's CITY_COORDS the same way tests/app.test.js does: give it
// a `window` to attach to, require it, read the table back out. Cached at
// module scope so repeated invocations in the same warm function instance
// don't re-parse app.js every request.
let _cityCoords = null;
export function loadCityCoords() {
  if (_cityCoords) return _cityCoords;
  const g = globalThis;
  const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
  const prevWindow = g.window;
  g.window = {};
  try {
    require("../../app.js");
    _cityCoords = (g.window.TravelIntel && g.window.TravelIntel.CITY_COORDS) || {};
  } finally {
    if (hadWindow) g.window = prevWindow; else delete g.window;
  }
  return _cityCoords;
}

// Pure: given the raw trips list (watch.mjs's normalizeTrip() shape) and
// the CITY_COORDS table, build the privacy-scoped output. Exported for the
// unit test — no Blobs or app.js load needed to exercise this directly.
export function buildWatchedTripsView(trips, cityCoords) {
  const out = [];
  const unmapped = [];
  for (const t of trips || []) {
    const coords = t && t.destIata ? cityCoords[String(t.destIata).toLowerCase()] : null;
    const dateStart = t.departDate || null;
    const dateEnd = t.returnDate || t.departDate || null;
    if (!coords) {
      if (t && t.id) unmapped.push(t.id);
      out.push({ id: t.id, destination: t.destination || t.destIata || null, lat: null, lon: null, dateStart, dateEnd });
      continue;
    }
    out.push({
      id: t.id,
      destination: t.destination || t.destIata || null,
      lat: coords[0],
      lon: coords[1],
      dateStart,
      dateEnd,
    });
  }
  return { trips: out, unmapped };
}

export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed — watched-trips is read-only" }, 405);
  }
  const store = getStore({ name: "watched-trips", consistency: "strong" });
  const rawTrips = (await store.get("list", { type: "json" })) || [];
  const cityCoords = loadCityCoords();
  const { trips, unmapped } = buildWatchedTripsView(rawTrips, cityCoords);
  return json({ trips, meta: { count: trips.length, unmapped } });
};
