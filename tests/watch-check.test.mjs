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
import { isStarAirline, isStarOffer, carrierLabel } from "../netlify/functions/lib/alliances.mjs";
import { mergeChecks, buildStopsSummary, isBeyondBookingHorizon, buildWatchLegs, applyAllianceFilter } from "../netlify/functions/watch-check.mjs";

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

// buildStopsSummary tests, added 2026-09-21 alongside the stops/layover
// summary itself: a route pill like SFO-VFA never revealed whether it was
// nonstop or hid a connection. Pure function, same "no live network calls"
// testing approach as mergeChecks above -- these exercise the split/via
// logic against hand-built SerpApi-shaped fixtures, not a real API call.

test("buildStopsSummary: nonstop, no return leg requested", () => {
  const segments = [{ departure_airport: { id: "SFO" }, arrival_airport: { id: "VFA" } }];
  const summary = buildStopsSummary(segments, [], null);
  assert.deepEqual(summary.outbound, { stops: 0, via: [] });
  assert.equal(summary.return, null);
});

test("buildStopsSummary: one stop, no return leg requested, layover name+duration carried through", () => {
  const segments = [
    { departure_airport: { id: "SFO" }, arrival_airport: { id: "JNB" } },
    { departure_airport: { id: "JNB" }, arrival_airport: { id: "VFA" } },
  ];
  const layovers = [{ id: "JNB", name: "O.R. Tambo", duration: 135 }];
  const summary = buildStopsSummary(segments, layovers, null);
  assert.deepEqual(summary.outbound, { stops: 1, via: [{ code: "JNB", name: "O.R. Tambo", minutes: 135 }] });
  assert.equal(summary.return, null);
});

test("buildStopsSummary: open-jaw trip splits outbound and return at the requested outbound destination", () => {
  const segments = [
    { departure_airport: { id: "SFO" }, arrival_airport: { id: "JNB" } },
    { departure_airport: { id: "JNB" }, arrival_airport: { id: "VFA" } }, // end of outbound leg
    { departure_airport: { id: "BBK" }, arrival_airport: { id: "JNB" } }, // start of return leg (open-jaw)
    { departure_airport: { id: "JNB" }, arrival_airport: { id: "SFO" } },
  ];
  const layovers = [
    { id: "JNB", name: "O.R. Tambo", duration: 135 },
    { id: "JNB", name: "O.R. Tambo", duration: 220 },
  ];
  const summary = buildStopsSummary(segments, layovers, "VFA");
  assert.deepEqual(summary.outbound, { stops: 1, via: [{ code: "JNB", name: "O.R. Tambo", minutes: 135 }] });
  assert.deepEqual(summary.return, { stops: 1, via: [{ code: "JNB", name: "O.R. Tambo", minutes: 220 }] });
});

test("buildStopsSummary: outboundDestIata given but not found in segments falls back to one leg rather than guessing a split", () => {
  const segments = [{ departure_airport: { id: "SFO" }, arrival_airport: { id: "VFA" } }];
  const summary = buildStopsSummary(segments, [], "SOMEWHERE_ELSE");
  assert.deepEqual(summary.outbound, { stops: 0, via: [] });
  assert.equal(summary.return, null);
});

test("buildStopsSummary: missing/malformed segments or layovers never throws", () => {
  assert.deepEqual(buildStopsSummary(undefined, undefined, null), { outbound: { stops: 0, via: [] }, return: null });
  assert.deepEqual(buildStopsSummary(null, null, null).outbound.stops, 0);
});


test("isBeyondBookingHorizon: a trip 400 days out is skipped, one 100 days out is searched", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(isBeyondBookingHorizon("2027-12-04", now), true);
  assert.equal(isBeyondBookingHorizon("2027-02-07", now), false);
  assert.equal(isBeyondBookingHorizon("garbage", now), false);
});

/* ---------- buildWatchLegs (stopover + open-jaw), 2026-11-22 ---------- */

test("buildWatchLegs: a plain trip returns null (keeps its single-route request)", () => {
  assert.equal(buildWatchLegs(trip()), null);
});

test("buildWatchLegs: a stopover round trip is origin>via, via>dest, return", () => {
  const legs = buildWatchLegs(trip({ viaIata: "JNB", viaNights: 0 }));
  assert.deepEqual(legs, [
    { departure_id: "SFO", arrival_id: "JNB", date: "2026-11-01" },
    { departure_id: "JNB", arrival_id: "GBE", date: "2026-11-01" },
    { departure_id: "GBE", arrival_id: "SFO", date: "2026-11-15" },
  ]);
});

test("buildWatchLegs: stopover nights push the onward leg date, including across a month end", () => {
  const legs = buildWatchLegs(trip({ viaIata: "JNB", viaNights: 2, departDate: "2026-10-30" }));
  assert.equal(legs[1].date, "2026-11-01");
});

test("buildWatchLegs: a one-way stopover has two legs", () => {
  assert.equal(buildWatchLegs(trip({ viaIata: "JNB", returnDate: null })).length, 2);
});

test("buildWatchLegs: open-jaw alone keeps its original two legs", () => {
  assert.deepEqual(buildWatchLegs(trip({ returnFromIata: "BBK" })), [
    { departure_id: "SFO", arrival_id: "GBE", date: "2026-11-01" },
    { departure_id: "BBK", arrival_id: "SFO", date: "2026-11-15" },
  ]);
});

test("buildWatchLegs: stopover plus open-jaw compose into three legs", () => {
  const legs = buildWatchLegs(trip({ viaIata: "JNB", returnFromIata: "BBK" }));
  assert.equal(legs.length, 3);
  assert.equal(legs[2].departure_id, "BBK");
});

/* ---------- alliance filter, 2026-11-22 ---------- */

const offer = (price, ...airlines) => ({ price, flights: airlines.map((a) => ({ airline: a })) });

test("isStarAirline: Ethiopian, South African, SWISS and United are Star; BA, Emirates, Airlink, SAS are not", () => {
  for (const a of ["United", "Ethiopian", "South African", "SWISS", "Lufthansa", "Turkish Airlines"]) assert.ok(isStarAirline(a), a);
  for (const a of ["British Airways", "Emirates", "Airlink", "CemAir Pty", "FlySafair", "Condor", "Scandinavian Airlines", "", null]) assert.equal(isStarAirline(a), false, String(a));
});

test("isStarOffer: every flight must be Star, and an empty offer never qualifies", () => {
  assert.ok(isStarOffer(offer(2069, "United", "Ethiopian")));
  assert.equal(isStarOffer(offer(2106, "British Airways", "South African")), false);
  assert.equal(isStarOffer(offer(2691, "Lufthansa", "Airlink")), false);
  assert.equal(isStarOffer({ price: 1, flights: [] }), false);
  assert.equal(isStarOffer({ price: 1 }), false);
});

test("applyAllianceFilter: no alliance returns everything; Star keeps only Star offers; carrier can change", () => {
  const all = [offer(1900, "British Airways", "South African"), offer(2069, "United", "Ethiopian"), offer(2601, "SWISS", "South African")];
  assert.equal(applyAllianceFilter(all, null).length, 3);
  const star = applyAllianceFilter(all, "Star Alliance");
  assert.deepEqual(star.map((o) => o.price), [2069, 2601]);
  assert.equal(star.reduce((m, o) => (o.price < m.price ? o : m)).price, 2069);
  assert.equal(carrierLabel(star[0]), "United + Ethiopian");
  assert.equal(carrierLabel(star[1]), "SWISS + South African");
});

test("applyAllianceFilter: when nothing qualifies the result is empty, so the check is skipped, not faked", () => {
  assert.equal(applyAllianceFilter([offer(1900, "British Airways")], "Star Alliance").length, 0);
});

console.log(`\n${passed} passed`);
