// tests/watch.test.mjs
// Tests for watch.mjs's pure decision logic (validateTripInput, buildWatchId,
// planAddTrip, planRemoveTrip, added 2026-08-05 alongside an optimistic-
// concurrency fix for the 3-trip cap race and a fix for returnDate/
// travelers being silently dropped from the watch-id). Same "export the
// pure logic for testability" pattern fares.mjs's buildFareCacheKey/
// parseLegs already use, no @netlify/blobs mocking needed since none of
// this touches storage. Run via `node tests/watch.test.mjs` (wired into
// `npm test`). No live network calls.

import assert from "node:assert/strict";
import { MAX_TRIPS, validateTripInput, buildWatchId, planAddTrip, planRemoveTrip } from "../netlify/functions/watch.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function trip(overrides) {
  return Object.assign({
    originIata: "SFO", destIata: "NRT", departDate: "2026-09-01",
    returnDate: "2026-09-10", cabin: "Economy", travelers: 1,
    origin: "San Francisco", destination: "Tokyo",
  }, overrides);
}

/* ---------- validateTripInput ---------- */

test("validateTripInput: a well-formed trip is valid", () => {
  assert.deepEqual(validateTripInput(trip()), { ok: true });
});

test("validateTripInput: rejects a missing/malformed IATA code", () => {
  assert.ok(validateTripInput(trip({ originIata: "sfo" })).error);
  assert.ok(validateTripInput(trip({ destIata: "" })).error);
  assert.ok(validateTripInput({}).error);
});

test("validateTripInput: rejects a malformed departDate", () => {
  assert.ok(validateTripInput(trip({ departDate: "9/1/2026" })).error);
});

test("validateTripInput: rejects a returnDate before departDate", () => {
  assert.ok(validateTripInput(trip({ departDate: "2026-09-10", returnDate: "2026-09-01" })).error);
});

test("validateTripInput: a missing/blank returnDate (one-way) is fine", () => {
  assert.deepEqual(validateTripInput(trip({ returnDate: "" })), { ok: true });
});

/* ---------- buildWatchId ---------- */

test("buildWatchId: same trip always produces the same id", () => {
  assert.equal(buildWatchId(trip()), buildWatchId(trip()));
});

test("buildWatchId (Susan's audit finding, 2026-08-05): a different returnDate produces a different id", () => {
  const a = buildWatchId(trip({ returnDate: "2026-09-10" }));
  const b = buildWatchId(trip({ returnDate: "2026-09-14" }));
  assert.notEqual(a, b, "watching the same route/date/cabin with a different return date must not collide");
});

test("buildWatchId: a different travelers count produces a different id", () => {
  const a = buildWatchId(trip({ travelers: 1 }));
  const b = buildWatchId(trip({ travelers: 2 }));
  assert.notEqual(a, b, "adults= is part of the real SerpApi request watch-check.mjs sends, so it must be part of the id");
});

test("buildWatchId: one-way (no returnDate) does not collide with a round-trip on the same dates", () => {
  const oneWay = buildWatchId(trip({ returnDate: "" }));
  const roundTrip = buildWatchId(trip({ returnDate: "2026-09-10" }));
  assert.notEqual(oneWay, roundTrip);
});

test("buildWatchId: an unspecified travelers count normalizes to 1, matching the stored-trip default", () => {
  const a = buildWatchId(trip({ travelers: undefined }));
  const b = buildWatchId(trip({ travelers: 1 }));
  assert.equal(a, b);
});

/* ---------- planAddTrip ---------- */

test("planAddTrip: adding to an empty list adds the trip", () => {
  const plan = planAddTrip([], trip());
  assert.equal(plan.action, "add");
  assert.equal(plan.trips.length, 1);
  assert.equal(plan.trips[0].originIata, "SFO");
  assert.equal(plan.trips[0].id, buildWatchId(trip()));
});

test("planAddTrip: invalid input returns an error plan, no trips touched", () => {
  const existing = [Object.assign({ id: "x" }, trip())];
  const plan = planAddTrip(existing, trip({ originIata: "" }));
  assert.equal(plan.action, "error");
  assert.equal(plan.status, 400);
});

test("planAddTrip: an exact duplicate (same id) is reported as already-watching, not re-added", () => {
  const existing = [Object.assign({ id: buildWatchId(trip()) }, trip())];
  const plan = planAddTrip(existing, trip());
  assert.equal(plan.action, "duplicate");
  assert.equal(plan.trips.length, 1);
});

test("planAddTrip (the fixed bug): the SAME route/date/cabin with a DIFFERENT returnDate is a real add, not a silent no-op", () => {
  const existing = [Object.assign({ id: buildWatchId(trip({ returnDate: "2026-09-10" })) }, trip({ returnDate: "2026-09-10" }))];
  const plan = planAddTrip(existing, trip({ returnDate: "2026-09-14" }));
  assert.equal(plan.action, "add", "a genuinely different return date must not be treated as 'already watching'");
  assert.equal(plan.trips.length, 2);
  assert.equal(plan.trips[1].returnDate, "2026-09-14");
});

const CAP_DESTS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]; // 3-letter, distinct, length must equal MAX_TRIPS
assert.equal(CAP_DESTS.length, MAX_TRIPS, "test fixture must track MAX_TRIPS if it ever changes");

test("planAddTrip: at the cap, a new (non-duplicate) trip is rejected with a 409", () => {
  const existing = CAP_DESTS.map((d) => Object.assign({ id: buildWatchId(trip({ destIata: d })) }, trip({ destIata: d })));
  const plan = planAddTrip(existing, trip({ destIata: "ZZZ" }));
  assert.equal(plan.action, "error");
  assert.equal(plan.status, 409);
});

test("planAddTrip: at the cap, re-watching an EXISTING trip is still just 'already watching', not blocked by the cap", () => {
  const existing = CAP_DESTS.map((d) => Object.assign({ id: buildWatchId(trip({ destIata: d })) }, trip({ destIata: d })));
  const plan = planAddTrip(existing, trip({ destIata: CAP_DESTS[0] }));
  assert.equal(plan.action, "duplicate");
});

test("planAddTrip: normalizes cabin/travelers the same way the old handler did (invalid cabin -> Economy, travelers clamped 1-9)", () => {
  const plan = planAddTrip([], trip({ cabin: "Cattle Class", travelers: 99 }));
  assert.equal(plan.trips[0].cabin, "Economy");
  assert.equal(plan.trips[0].travelers, 9);
});

/* ---------- planRemoveTrip ---------- */

test("planRemoveTrip: removing an existing id filters it out", () => {
  const existing = [Object.assign({ id: "keep" }, trip()), Object.assign({ id: "drop" }, trip())];
  const plan = planRemoveTrip(existing, "drop");
  assert.equal(plan.action, "remove");
  assert.deepEqual(plan.trips.map((t) => t.id), ["keep"]);
});

test("planRemoveTrip: removing an id that isn't present is a no-op (and callers should skip the write)", () => {
  const existing = [Object.assign({ id: "keep" }, trip())];
  const plan = planRemoveTrip(existing, "not-there");
  assert.equal(plan.action, "noop");
  assert.deepEqual(plan.trips.map((t) => t.id), ["keep"]);
});

console.log(`\n${passed} passed`);
