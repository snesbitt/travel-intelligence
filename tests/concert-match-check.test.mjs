// tests/concert-match-check.test.mjs
// Tests for concert-match-check.mjs's pure logic (computeMatchUpdate,
// matchKey, resolveTripCoords), added 2026-08-06, the weekly server-side
// half of the Concert Radar <-> Travel Intelligence integration (Susan's
// direct request: "this feature needs to also have a weekly check for new
// matches if you didn't already implement that"). Same "export the pure
// logic for testability" pattern watch.mjs/watched-trips.mjs already use.
// No @netlify/blobs mocking, no live network calls.
//
// Run via `node tests/concert-match-check.test.mjs` (wired into `npm test`).

import assert from "node:assert/strict";
import { computeMatchUpdate, matchKey } from "../scripts/concert-match-check.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const NOW = "2026-08-06T12:00:00.000Z";

/* ---------- matchKey ---------- */

test("matchKey: case- and whitespace-insensitive", () => {
  assert.equal(matchKey("Ziggy Marley"), "ziggy marley");
  assert.equal(matchKey("  Ziggy Marley  "), "ziggy marley");
  assert.equal(matchKey("ZIGGY MARLEY"), "ziggy marley");
});

test("matchKey: null/undefined/empty are all the same empty key, not a throw", () => {
  assert.equal(matchKey(null), "");
  assert.equal(matchKey(undefined), "");
  assert.equal(matchKey(""), "");
});

/* ---------- computeMatchUpdate ---------- */

test("computeMatchUpdate: first-ever run treats every match as new", () => {
  const result = computeMatchUpdate(null, [{ artist: "Ziggy Marley" }, { artist: "Santigold" }], NOW);
  assert.deepEqual(result.newThisWeek.sort(), ["Santigold", "Ziggy Marley"]);
  assert.equal(result.firstSeenAt["ziggy marley"], NOW);
  assert.equal(result.firstSeenAt["santigold"], NOW);
  assert.equal(result.lastCheckedAt, NOW);
});

test("computeMatchUpdate: an artist already in firstSeenAt is NOT reported as new again", () => {
  const prev = { firstSeenAt: { "ziggy marley": "2026-07-30T12:00:00.000Z" } };
  const result = computeMatchUpdate(prev, [{ artist: "Ziggy Marley" }], NOW);
  assert.deepEqual(result.newThisWeek, [], "already-known artist should not reappear as new");
  assert.equal(result.firstSeenAt["ziggy marley"], "2026-07-30T12:00:00.000Z", "original first-seen timestamp is preserved, not overwritten");
});

test("computeMatchUpdate: mixes known and newly-appeared artists correctly in one run", () => {
  const prev = { firstSeenAt: { "ziggy marley": "2026-07-30T12:00:00.000Z" } };
  const result = computeMatchUpdate(prev, [{ artist: "Ziggy Marley" }, { artist: "Santigold" }], NOW);
  assert.deepEqual(result.newThisWeek, ["Santigold"]);
  assert.ok(result.firstSeenAt["santigold"] === NOW);
  assert.ok(result.firstSeenAt["ziggy marley"] === "2026-07-30T12:00:00.000Z");
});

test("computeMatchUpdate: an artist that drops off the match list keeps its firstSeenAt entry (history, not a live roster)", () => {
  const prev = { firstSeenAt: { "beck": "2026-07-01T00:00:00.000Z" } };
  const result = computeMatchUpdate(prev, [{ artist: "Ziggy Marley" }], NOW);
  assert.equal(result.firstSeenAt["beck"], "2026-07-01T00:00:00.000Z", "past matches aren't erased just because they're not in this run's list");
  assert.deepEqual(result.newThisWeek, ["Ziggy Marley"]);
});

test("computeMatchUpdate: no matches this run is safe, empty newThisWeek, firstSeenAt untouched", () => {
  const prev = { firstSeenAt: { "beck": "2026-07-01T00:00:00.000Z" } };
  const result = computeMatchUpdate(prev, [], NOW);
  assert.deepEqual(result.newThisWeek, []);
  assert.deepEqual(result.firstSeenAt, { "beck": "2026-07-01T00:00:00.000Z" });
  assert.deepEqual(result.lastMatches, []);
});

test("computeMatchUpdate: null/undefined matches list is safe, same as empty", () => {
  const result = computeMatchUpdate(null, null, NOW);
  assert.deepEqual(result.newThisWeek, []);
  assert.deepEqual(result.lastMatches, []);
});

test("computeMatchUpdate: a blank/whitespace-only artist name is skipped, not stored as a match", () => {
  const result = computeMatchUpdate(null, [{ artist: "" }, { artist: "   " }, { artist: "Ziggy Marley" }], NOW);
  assert.deepEqual(result.newThisWeek, ["Ziggy Marley"]);
});

test("computeMatchUpdate: the same artist appearing twice in one run (two shows) is only reported new once", () => {
  const result = computeMatchUpdate(null, [{ artist: "Ziggy Marley" }, { artist: "Ziggy Marley" }], NOW);
  assert.deepEqual(result.newThisWeek, ["Ziggy Marley"]);
});

/* resolveTripCoords tests removed 2026-08-25: coordinate resolution
   moved to watched-trips.mjs (the API now returns lat/lon directly),
   already covered by buildWatchedTripsView tests in
   tests/watched-trips.test.mjs. */
