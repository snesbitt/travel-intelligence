// netlify/functions/watched-trips.mjs
// version: 3
// Phase 10, Concert Radar hooks (2026-08-05). Travel Intelligence's half
// of the bidirectional integration with Vinyl Scout's Concert Radar.
// Updated 2026-08-15 as the second half of the concert-match-check
// GitHub Actions migration (see scripts/concert-match-check.mjs and
// .github/workflows/concert-match-check.yml, added same day): the
// newMatches merge reads the git-committed data/concert-match-log.json
// the Actions workflow writes every Monday.
// Updated again 2026-08-30: the OLD Netlify-scheduled
// concert-match-check.mjs (and the 'concert-match-log' Blobs store it
// wrote to) was retired 2026-08-26 -- PR #6, already merged -- with no
// replacement writer left for that store. The committed-file path had
// run clean on its own schedule twice by then (2026-08-17, 2026-08-24)
// with no gap, so the v2 Blobs-read fallback here was dead weight: it
// could only ever serve increasingly stale data from a store nothing
// updates anymore, silently, on a bad day for the committed-file read.
// Removed. A committed-file read failure now just yields no new matches
// for that request, matching this endpoint's existing best-effort
// promise below rather than reaching for silently-stale data. The old
// Blobs store itself is orphaned but not deleted -- deleting it needs a
// live Blobs call this environment isn't set up to make safely, and an
// unread store costs nothing.
//
// EVERYTHING BELOW THIS POINT IS UNCHANGED FROM v1 except the
// newMatches-merge block inside the default handler (search for "v2"
// below) -- the core job of this endpoint (privacy-scoped destination/
// lat/lon/dates per watched trip, GET-only, CORS-enabled for Vinyl
// Scout) is untouched.
//
// GET /api/watched-trips
// Returns ONLY destination city + lat/lon + date range per watched trip,
// deliberately never originIata, cabin, travelers, baseline price, or the
// nightly `checks` history. This is the privacy-scoping commitment this
// repo's own CLAUDE.md already documented before this file existed: Vinyl
// Scout's artists-playing.mjs only ever needs to know WHERE and WHEN, never
// fares or points data. Reuses the SAME 'watched-trips' Blobs store
// watch.mjs already owns (read-only here), no new store, no new write
// path, per this repo's "radical simplicity" rule.
//
// lat/lon come from netlify/functions/lib/city-coords.mjs, a verified-
// in-sync duplicate of app.js's own CITY_COORDS table -- see that file's
// header comment for why this is a real static import.
//
// One-way trips (no returnDate) report dateStart === dateEnd === departDate,
// an honest simplification: this repo has no signal for how long a
// one-way traveler stays, so the match window is scoped to just the depart
// day rather than guessing a trip length.
//
// PURE READ. Never writes. Not gated, same rationale as the rest of this
// integration's read endpoints.
//
// Also merges in `newMatches` per trip -- see the v2 block below for
// where that data now comes from. Best-effort: any failure here just
// yields an empty array per trip, never a broken response; this
// endpoint's core job (trip coordinates/dates) must never depend on a
// second data source being healthy.
//
// This endpoint is called cross-origin two separate ways: Travel
// Intelligence's OWN checkConcertMatches() (same origin, no CORS needed)
// and Vinyl Scout's concert-radar.html fetching this URL directly from
// vinylscout.org (a real cross-origin caller, fixed 2026-08-06 with an
// explicit Access-Control-Allow-Origin header, allow-listed to the real
// caller). That fix is unchanged by this update.

import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

// Static import, kept as a function, not an inline reference, only so the
// existing test suite and the handler below don't need to change shape.
export function loadCityCoords() {
  return CITY_COORDS;
}

// Pure: given the raw trips list (watch.mjs's normalizeTrip() shape), the
// CITY_COORDS table, and an optional id->newMatches map, build the
// privacy-scoped output. Exported for the unit test, no Blobs or app.js
// load needed to exercise this directly. UNCHANGED from v1.
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

// v2, new: reads the GitHub Actions-committed match log. Returns a plain
// {tripId: {newThisWeek: [...], ...}} map matching the shape
// buildWatchedTripsView already expects (it only reads .newThisWeek per
// entry via the caller below, same as it read the Blobs record's
// .newThisWeek in v1).
async function readCommittedMatchLog() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const jsonPath = path.join(here, "..", "..", "data", "concert-match-log.json");
  const raw = await readFile(jsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("committed concert-match-log.json is not an object");
  }
  return parsed;
}


export default async (req) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed: watched-trips is read-only" }, 405);
  }
  const store = getStore({ name: "watched-trips", consistency: "strong" });
  const rawTrips = (await store.get("list", { type: "json" })) || [];
  const cityCoords = loadCityCoords();
  const tripIds = (rawTrips || []).filter((t) => t && t.id).map((t) => t.id);

  // Any failure here just yields {} / empty arrays per trip -- this
  // endpoint's core job must never depend on the match-log source being
  // healthy (no Blobs fallback since 2026-08-30; see header).
  let newMatchesById = {};
  try {
    const committed = await readCommittedMatchLog();
    // Reshape to the {id: newThisWeek[]} form buildWatchedTripsView expects.
    newMatchesById = Object.fromEntries(
      tripIds.map((id) => [id, Array.isArray(committed[id] && committed[id].newThisWeek) ? committed[id].newThisWeek : []])
    );
  } catch (committedErr) {
    console.warn("watched-trips.mjs: committed match log read failed, no new matches this request:", committedErr.message);
  }

  const { trips, unmapped } = buildWatchedTripsView(rawTrips, cityCoords, newMatchesById);
  return json({ trips, meta: { count: trips.length, unmapped } });
};
