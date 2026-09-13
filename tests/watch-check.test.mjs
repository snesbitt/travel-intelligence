// tests/watch-check.test.mjs
// Tests for watch-check.mjs's pure mergeChecks logic, added 2026-09-13
// as the fix for trips silently disappearing: the scheduled re-search job
// used to finish its run by blindly overwriting the whole "list" key with
// whatever it read at the START of the run, discarding any trip a user
// added or removed via watch.mjs's own (properly optimistic-concurrency-
// guarded) POST/DELETE handlers while the job was still in flight. Real
// history in data/concert-match-log.json's own commit messages shows the
// live trip count silently dropping 4 -> 3 -> 1 with no corresponding
// deletions, the signature of exactly this race.
//
// mergeChecks is the pure function that replaced the blind overwrite: it
// takes whatever the list looks like RIGHT NOW (a fresh read, taken just
// before the write) and layers in only the check-array updates this run
// actually produced, by trip id -- so a trip added or removed mid-run
// survives untouched. No @netlify/blobs mocking needed, same "export the
// pure logic for testability" pattern watch.mjs's planAddTrip/planRemoveTrip
// already use. Run via `node tests/watch-check.test.mjs` (wired into
// `npm test`). No live network calls.

import assert from "node:assert/strict";
import { mergeChecks } from "../netlify/functions/watch-check.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function trip(overrides) {
  return Object.assign({
    id: "SFO|GBE|2026-11-01|Economy|2026-11-15|1|-",
    originIata: "SFO", destIata: "GBE", departDate: "2026-11-01",
    returnDate: "2026-11-15", cabin: "Economy", travelers: 1,
    origin: "San Francisco", destination: "Gaborone",
    checks: [],
  }, overrides);
}

test("mergeChecks: applies a check update to the matching trip by id", () => {
  const current = [trip()];
  const merged = mergeChecks(current, { [current[0].id]: [{ at: "2026-09-13T00:00:00Z", price: 1200, carrier: "United" }] });
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].checks, [{ at: "2026-09-13T00:00:00Z", price: 1200, carrier: "United" }]);
});

test("mergeChecks: leaves a trip untouched when it has no update in checkedById", () => {
  const untouched = trip({ id: "SFO|ORD|2026-11-15|Economy|2026-11-19|1|-" });
  const merged = mergeChecks([untouched], {});
  assert.deepEqual(merged, [untouched]);
});

test("mergeChecks: THE ACTUAL BUG -- a trip added mid-run (present in the fresh read, absent from this run's own start-of-run snapshot) survives instead of being silently dropped", () => {
  const preExisting = trip({ id: "SFO|ORD|2026-11-15|Economy|2026-11-19|1|-" });
  const addedMidRun = trip({ id: "SFO|GBE|2026-11-01|Economy|2026-11-15|1|-", checks: [] });
  // "currentTrips" simulates a FRESH read taken right before the write --
  // it already includes the trip a user added via watch.mjs while this
  // job was still mid-flight. checkedById only has an update for the
  // trip this run actually re-searched (the pre-existing one).
  const current = [preExisting, addedMidRun];
  const merged = mergeChecks(current, { [preExisting.id]: [{ at: "2026-09-13T00:00:00Z", price: 500, carrier: "Delta" }] });
  assert.equal(merged.length, 2, "the mid-run addition must survive, not be dropped");
  assert.ok(merged.some((t) => t.id === addedMidRun.id), "the newly added trip must still be present");
});

test("mergeChecks: a trip removed mid-run (absent from the fresh read) stays absent -- an explicit unwatch is never resurrected", () => {
  const stillWatching = trip({ id: "SFO|ORD|2026-11-15|Economy|2026-11-19|1|-" });
  const removedMidRun = trip({ id: "SFO|GBE|2026-11-01|Economy|2026-11-15|1|-" });
  // "current" is the fresh read -- the removed trip is already gone from it.
  const current = [stillWatching];
  const merged = mergeChecks(current, {
    [stillWatching.id]: [{ at: "2026-09-13T00:00:00Z", price: 500, carrier: "Delta" }],
    [removedMidRun.id]: [{ at: "2026-09-13T00:00:00Z", price: 900, carrier: "Qatar" }],
  });
  assert.equal(merged.length, 1);
  assert.ok(!merged.some((t) => t.id === removedMidRun.id));
});

test("mergeChecks: empty checkedById is a no-op copy", () => {
  const current = [trip(), trip({ id: "SFO|ORD|2026-11-15|Economy|2026-11-19|1|-" })];
  assert.deepEqual(mergeChecks(current, {}), current);
});

test("mergeChecks: handles an empty current list", () => {
  assert.deepEqual(mergeChecks([], { "some|id": [] }), []);
  assert.deepEqual(mergeChecks(null, {}), []);
});

console.log(`\n${passed} passed`);
