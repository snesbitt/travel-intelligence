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
// lat/lon come from netlify/functions/lib/city-coords.mjs, a verified-
// in-sync duplicate of app.js's own CITY_COORDS table — see that file's
// header comment for why this is a real static import rather than the
// createRequire("../../app.js") trick the first version of this file
// used: that worked in every local test but 502'd in production, because
// Netlify's function bundler only packages files reachable through
// static imports, and a dynamic require to a path outside this function's
// own directory tree is invisible to it. Fixed 2026-08-05, the same day
// it shipped. tests/watched-trips.test.mjs still cross-checks this file's
// table against app.js's own (loaded via createRequire, which is safe in
// a Node test process — just not in the deployed function) so the two
// can never silently drift apart.
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
import { CITY_COORDS } from "./lib/city-coords.mjs";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/watched-trips" };

// Static import (see the import above and lib/city-coords.mjs's header
// comment) — kept as a function, not an inline reference, only so the
// existing test suite and the handler below don't need to change shape.
export function loadCityCoords() {
  return CITY_COORDS;
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
