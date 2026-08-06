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
//
// 2026-08-06, later: also merges in `newMatches` per trip — artists
// concert-match-check.mjs's weekly scheduled sweep saw for the FIRST time
// as of its last run (state lives in a separate 'concert-match-log' store,
// read-only here, same store-isolation discipline as everything else in
// this integration). Best-effort: a read failure or a trip concert-match-
// check.mjs hasn't gotten to yet just yields an empty array, never a
// broken response — this endpoint's core job (trip coordinates/dates) must
// never depend on a second store being healthy. checkConcertMatches() in
// index.html uses this to badge a match "new this week" instead of
// presenting every live match as freshly discovered on every single visit.
//
// 2026-08-06, same-week fix: this endpoint is called cross-origin two
// separate ways — Travel Intelligence's OWN checkConcertMatches() (same
// origin, no CORS needed) and, it turns out, Vinyl Scout's
// concert-radar.html fetching this URL directly from vinylscout.org (a
// second real cross-origin caller nobody had traced through until Susan
// reported "no change" on BOTH sites and a browser console check on
// vinylscout.org/concert-radar.html showed the exact same class of bug
// this repo already fixed once, on the OTHER endpoint, in the OTHER repo:
// "No 'Access-Control-Allow-Origin' header is present on the requested
// resource." json() below only ever set Content-Type/Cache-Control, never
// that header — so every direct/same-origin/tool check of this endpoint
// kept returning a correct 200 (exactly the same false-negative pattern
// that hid vinyl-scout-repo's artists-playing.mjs bug), while the one real
// cross-site caller silently got nothing. Fixed the same way: an explicit
// Access-Control-Allow-Origin header, allow-listed to the real caller.

import { getStore } from "@netlify/blobs";
import { CITY_COORDS } from "./lib/city-coords.mjs";

// The real cross-origin caller (Vinyl Scout's concert-radar.html fetching
// this endpoint directly). Exported so the test script can assert the
// header without re-hardcoding this string a second place.
export var ALLOWED_ORIGIN = "https://vinylscout.org";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin",
    },
  });
}

export const config = { path: "/api/watched-trips" };

// Static import (see the import above and lib/city-coords.mjs's header
// comment) — kept as a function, not an inline reference, only so the
// existing test suite and the handler below don't need to change shape.
export function loadCityCoords() {
  return CITY_COORDS;
}

// Pure: given the raw trips list (watch.mjs's normalizeTrip() shape), the
// CITY_COORDS table, and an optional id->newMatches map (concert-match-
// check.mjs's weekly output — omit or pass {} and every trip just gets an
// empty array), build the privacy-scoped output. Exported for the unit
// test — no Blobs or app.js load needed to exercise this directly.
export function buildWatchedTripsView(trips, cityCoords, newMatchesById) {
  const out = [];
  const unmapped = [];
  const newById = newMatchesById || {};
  for (const t of trips || []) {
    const coords = t && t.destIata ? cityCoords[String(t.destIata).toLowerCase()] : null;
    const dateStart = t.departDate || null;
    const dateEnd = t.returnDate || t.departDate || null;
    const newMatches = (t && t.id && Array.isArray(newById[t.id])) ? newById[t.id] : [];
    if (!coords) {
      if (t && t.id) unmapped.push(t.id);
      out.push({ id: t.id, destination: t.destination || t.destIata || null, lat: null, lon: null, dateStart, dateEnd, newMatches });
      continue;
    }
    out.push({
      id: t.id,
      destination: t.destination || t.destIata || null,
      lat: coords[0],
      lon: coords[1],
      dateStart,
      dateEnd,
      newMatches,
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

  // Best-effort merge of concert-match-check.mjs's weekly output — a
  // separate store, read-only here. Any failure (store empty, a trip never
  // swept yet, a transient error) just yields {} / empty arrays; this
  // endpoint's core job must never depend on the weekly job having run.
  let newMatchesById = {};
  try {
    const matchStore = getStore({ name: "concert-match-log", consistency: "strong" });
    const entries = await Promise.all(
      (rawTrips || []).filter((t) => t && t.id).map(async (t) => {
        const rec = await matchStore.get(t.id, { type: "json" });
        return [t.id, rec && Array.isArray(rec.newThisWeek) ? rec.newThisWeek : []];
      })
    );
    newMatchesById = Object.fromEntries(entries);
  } catch (e) { /* weekly-check data is a bonus, never a blocker — see header comment */ }

  const { trips, unmapped } = buildWatchedTripsView(rawTrips, cityCoords, newMatchesById);
  return json({ trips, meta: { count: trips.length, unmapped } });
};
