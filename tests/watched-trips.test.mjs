// tests/watched-trips.test.mjs
// Tests for watched-trips.mjs's pure logic (buildWatchedTripsView) and its
// app.js-loading helper (loadCityCoords) — added 2026-08-05, Phase 10
// (Concert Radar hooks). Same "export the pure logic for testability"
// pattern watch.mjs/fares.mjs already use. No @netlify/blobs mocking
// needed — buildWatchedTripsView takes a plain trips array, and
// loadCityCoords loads the real app.js the same way tests/app.test.js
// does, so this also incidentally re-proves app.js's CITY_COORDS export
// didn't break anything. Run via `node tests/watched-trips.test.mjs`
// (wired into `npm test`). No live network calls.

import assert from "node:assert/strict";
import { buildWatchedTripsView, loadCityCoords } from "../netlify/functions/watched-trips.mjs";

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

test("loadCityCoords: loads the real app.js CITY_COORDS table (single source of truth, not duplicated)", () => {
  const coords = loadCityCoords();
  assert.ok(coords.sfo, "sfo should resolve from the real app.js table");
  assert.ok(Array.isArray(coords.sfo) && coords.sfo.length === 2, "coords are a [lat, lon] pair");
  assert.ok(coords.nrt, "nrt (Tokyo Narita) should also resolve");
});

test("loadCityCoords: repeated calls return the same cached object rather than re-requiring app.js every time", () => {
  const first = loadCityCoords();
  const second = loadCityCoords();
  assert.equal(first, second, "module-scope cache returns the identical object on a second call");
});

console.log(`\n${passed} passed`);
