// tests/watched-trips.test.mjs
// Tests for watched-trips.mjs's pure logic (buildWatchedTripsView) and its
// coordinate table (loadCityCoords) — added 2026-08-05, Phase 10 (Concert
// Radar hooks). Same "export the pure logic for testability" pattern
// watch.mjs/fares.mjs already use. No @netlify/blobs mocking needed —
// buildWatchedTripsView takes a plain trips array.
//
// 2026-08-05, same-day fix: loadCityCoords originally loaded app.js's
// CITY_COORDS at runtime via createRequire("../../app.js") — passed every
// local test and node --check, then 502'd in production because Netlify's
// function bundler can't see a dynamic require to a file outside this
// function's own directory tree, so app.js never made it into the
// deployed bundle. Fixed by moving the table into
// netlify/functions/lib/city-coords.mjs, a real static import (the
// pattern the bundler actually supports). The sync-check test below is
// what stands in for "single source of truth" now that there are
// deliberately two copies of this table: it loads app.js's copy the SAME
// way the old runtime code did (createRequire — safe in a Node test
// process, just not in the deployed function) and diffs every key/value
// against lib/city-coords.mjs, so the two can never silently drift apart
// without failing the suite.
//
// Run via `node tests/watched-trips.test.mjs` (wired into `npm test`).
// No live network calls.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildWatchedTripsView, loadCityCoords } from "../netlify/functions/watched-trips.mjs";
import { CITY_COORDS as LIB_CITY_COORDS } from "../netlify/functions/lib/city-coords.mjs";

const require = createRequire(import.meta.url);

// Loads app.js's CITY_COORDS the same way tests/app.test.js does: stub a
// `window` for app.js to attach to, require it, read the table back out.
// ONLY used here, for the sync-check test — production code no longer
// does this (see the file header above).
function loadAppJsCityCoords() {
  const g = globalThis;
  const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
  const prevWindow = g.window;
  g.window = {};
  try {
    require("../app.js");
    return (g.window.TravelIntel && g.window.TravelIntel.CITY_COORDS) || {};
  } finally {
    if (hadWindow) g.window = prevWindow; else delete g.window;
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const CITY_COORDS = { sfo: [37.62, -122.38], nrt: [35.77, 140.39] };

function trip(overrides) {
  return Object.assign({
    id: "SFO|NRT|2026-09-01|Economy|2026-09-10|1",
    originIata: "SFO", destIata: "NRT", departDate: "2026-09-01",
    returnDate: "2026-09-10", cabin: "Economy", travelers: 1,
    origin: "San Francisco", destination: "Tokyo",
    baseline: { price: 1200, carrier: "ANA", at: "2026-08-01T00:00:00.000Z" },
    checks: [{ at: "2026-08-02T00:00:00.000Z", price: 1180 }],
  }, overrides);
}

/* ---------- buildWatchedTripsView ---------- */

test("buildWatchedTripsView: a mapped trip returns destination + lat/lon + date range only", () => {
  const { trips } = buildWatchedTripsView([trip()], CITY_COORDS);
  assert.equal(trips.length, 1);
  assert.deepEqual(trips[0], {
    id: "SFO|NRT|2026-09-01|Economy|2026-09-10|1",
    destination: "Tokyo",
    lat: 35.77,
    lon: 140.39,
    dateStart: "2026-09-01",
    dateEnd: "2026-09-10",
  });
});

test("buildWatchedTripsView: never leaks originIata, cabin, travelers, baseline, or checks", () => {
  const { trips } = buildWatchedTripsView([trip()], CITY_COORDS);
  const keys = Object.keys(trips[0]);
  assert.deepEqual(keys.sort(), ["dateEnd", "dateStart", "destination", "id", "lat", "lon"]);
});

test("buildWatchedTripsView: a one-way trip (no returnDate) uses departDate for both ends", () => {
  const { trips } = buildWatchedTripsView([trip({ returnDate: null })], CITY_COORDS);
  assert.equal(trips[0].dateStart, "2026-09-01");
  assert.equal(trips[0].dateEnd, "2026-09-01");
});

test("buildWatchedTripsView: an unmapped destIata reports null lat/lon and lands in meta.unmapped, not silently dropped", () => {
  const { trips, unmapped } = buildWatchedTripsView([trip({ destIata: "GBE", destination: "Gaborone" })], CITY_COORDS);
  assert.equal(trips.length, 1, "trip is still present in the output");
  assert.equal(trips[0].lat, null);
  assert.equal(trips[0].lon, null);
  assert.deepEqual(unmapped, ["SFO|NRT|2026-09-01|Economy|2026-09-10|1"]);
});

test("buildWatchedTripsView: an empty/missing trips list returns an empty result, no throw", () => {
  assert.deepEqual(buildWatchedTripsView([], CITY_COORDS), { trips: [], unmapped: [] });
  assert.deepEqual(buildWatchedTripsView(null, CITY_COORDS), { trips: [], unmapped: [] });
  assert.deepEqual(buildWatchedTripsView(undefined, CITY_COORDS), { trips: [], unmapped: [] });
});

test("buildWatchedTripsView: multiple trips are each handled independently", () => {
  const { trips, unmapped } = buildWatchedTripsView(
    [trip(), trip({ id: "second", destIata: "SFO", destination: "San Francisco", returnDate: "" })],
    CITY_COORDS
  );
  assert.equal(trips.length, 2);
  assert.equal(trips[1].lat, 37.62);
  assert.equal(trips[1].dateStart, trips[1].dateEnd);
  assert.deepEqual(unmapped, []);
});

/* ---------- loadCityCoords ---------- */

test("loadCityCoords: returns the lib/city-coords.mjs table used in production", () => {
  const coords = loadCityCoords();
  assert.ok(coords.sfo, "sfo should resolve");
  assert.ok(Array.isArray(coords.sfo) && coords.sfo.length === 2, "coords are a [lat, lon] pair");
  assert.ok(coords.nrt, "nrt (Tokyo Narita) should also resolve");
});

test("loadCityCoords: repeated calls return the identical object (it's a static import, not a fresh load each time)", () => {
  const first = loadCityCoords();
  const second = loadCityCoords();
  assert.equal(first, second, "same reference on a second call");
});

/* ---------- sync check: lib/city-coords.mjs vs. app.js's own table ----------
   The two tables are a deliberate duplicate (see file header) — this is
   what catches them drifting apart instead of a silent runtime mismatch. */

test("lib/city-coords.mjs stays in sync with app.js's CITY_COORDS — same keys, same coordinates", () => {
  const appCoords = loadAppJsCityCoords();
  const appKeys = Object.keys(appCoords).sort();
  const libKeys = Object.keys(LIB_CITY_COORDS).sort();
  assert.deepEqual(libKeys, appKeys, "lib/city-coords.mjs is missing or has extra keys vs. app.js's CITY_COORDS — copy the current app.js table over");
  for (const key of appKeys) {
    assert.deepEqual(LIB_CITY_COORDS[key], appCoords[key], `coordinates for "${key}" differ between app.js and lib/city-coords.mjs`);
  }
});

console.log(`\n${passed} passed`);
