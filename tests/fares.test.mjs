// tests/fares.test.mjs
// Tests for fares.mjs's quota-protection cache logic (buildFareCacheKey,
// isCacheFresh, CACHE_TTL_MS — added 2026-07-20). Pure functions only, no
// fetch/@netlify/blobs mocking needed: this is the same "export the pure
// logic for testability" pattern vinyl-scout's audio-preview.mjs uses.
// Run via `node tests/fares.test.mjs` (also wired into `npm test`, see
// package.json). No live network calls, no SerpApi key needed.

import assert from "node:assert/strict";
import { buildFareCacheKey, isCacheFresh, CACHE_TTL_MS, parseLegs, buildLegsCacheKey, isAllowedOrigin, isOverDailyCap, DAILY_SEARCH_CAP, todayQuotaKey, mapOffers } from "../netlify/functions/fares.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

/* ---------- buildFareCacheKey ---------- */

test("buildFareCacheKey: same search params always produce the same key", () => {
  const a = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  const b = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  assert.equal(a, b);
});

test("buildFareCacheKey: different origin produces a different key", () => {
  const a = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  const b = buildFareCacheKey("OAK", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  assert.notEqual(a, b);
});

test("buildFareCacheKey: different cabin produces a different key (cabin comparisons must not collide)", () => {
  const economy = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  const business = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Business");
  assert.notEqual(economy, business);
});

test("buildFareCacheKey: one-way (empty returnDate) does not collide with a round-trip search for the same dates", () => {
  const oneWay = buildFareCacheKey("SFO", "JFK", "2026-08-01", "", 1, "Economy");
  const roundTrip = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  assert.notEqual(oneWay, roundTrip);
});

test("buildFareCacheKey: different adult count produces a different key", () => {
  const a = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  const b = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 2, "Economy");
  assert.notEqual(a, b);
});

test("buildFareCacheKey: is prefixed 'farecache-' so it can never collide with the watched-trips store's own keys ('list', 'health', 'backup-*')", () => {
  const key = buildFareCacheKey("SFO", "JFK", "2026-08-01", "2026-08-10", 1, "Economy");
  assert.ok(key.startsWith("farecache-"));
  assert.notEqual(key, "list");
  assert.notEqual(key, "health");
});

/* ---------- isCacheFresh ---------- */

test("isCacheFresh: a hit from 1 minute ago is fresh (well within the 15-min TTL)", () => {
  const now = 1_000_000_000_000;
  const cachedAt = now - 60_000; // 1 min ago
  assert.equal(isCacheFresh(cachedAt, now, CACHE_TTL_MS), true);
});

test("isCacheFresh: a hit from exactly 15 minutes ago is NOT fresh (TTL boundary is exclusive)", () => {
  const now = 1_000_000_000_000;
  const cachedAt = now - CACHE_TTL_MS; // exactly at the boundary
  assert.equal(isCacheFresh(cachedAt, now, CACHE_TTL_MS), false);
});

test("isCacheFresh: a hit from 15 minutes and 1ms ago is NOT fresh", () => {
  const now = 1_000_000_000_000;
  const cachedAt = now - CACHE_TTL_MS - 1;
  assert.equal(isCacheFresh(cachedAt, now, CACHE_TTL_MS), false);
});

test("isCacheFresh: a hit from 14:59 ago (1ms under the TTL) IS fresh", () => {
  const now = 1_000_000_000_000;
  const cachedAt = now - CACHE_TTL_MS + 1;
  assert.equal(isCacheFresh(cachedAt, now, CACHE_TTL_MS), true);
});

test("isCacheFresh: a missing/malformed cachedAt (undefined, from a corrupt or pre-cache-feature blob entry) is treated as not fresh, not a crash", () => {
  const now = 1_000_000_000_000;
  assert.equal(isCacheFresh(undefined, now, CACHE_TTL_MS), false);
  assert.equal(isCacheFresh(null, now, CACHE_TTL_MS), false);
  assert.equal(isCacheFresh("not-a-number", now, CACHE_TTL_MS), false);
});

test("CACHE_TTL_MS is exactly 15 minutes", () => {
  assert.equal(CACHE_TTL_MS, 15 * 60 * 1000);
});


/* ---------- parseLegs (v3, multi-city via/stopover routing) ---------- */

test("parseLegs: valid 2-leg via routing parses and normalizes to uppercase", () => {
  const legs = parseLegs(JSON.stringify([
    { origin: "sfo", destination: "kix", date: "2027-07-10" },
    { origin: "kix", destination: "bkk", date: "2027-07-12" },
  ]));
  assert.deepEqual(legs, [
    { origin: "SFO", destination: "KIX", date: "2027-07-10" },
    { origin: "KIX", destination: "BKK", date: "2027-07-12" },
  ]);
});

test("parseLegs: valid 3-leg (with return) parses", () => {
  const legs = parseLegs(JSON.stringify([
    { origin: "SFO", destination: "KIX", date: "2027-07-10" },
    { origin: "KIX", destination: "BKK", date: "2027-07-12" },
    { origin: "BKK", destination: "SFO", date: "2027-07-20" },
  ]));
  assert.equal(legs.length, 3);
});

test("parseLegs: rejects fewer than 2 legs", () => {
  assert.equal(parseLegs(JSON.stringify([{ origin: "SFO", destination: "KIX", date: "2027-07-10" }])), null);
});

test("parseLegs: rejects more than 4 legs", () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ origin: "SFO", destination: "KIX", date: `2027-07-${10 + i}` }));
  assert.equal(parseLegs(JSON.stringify(five)), null);
});

test("parseLegs: rejects a non-IATA origin", () => {
  assert.equal(parseLegs(JSON.stringify([
    { origin: "San Francisco", destination: "KIX", date: "2027-07-10" },
    { origin: "KIX", destination: "BKK", date: "2027-07-12" },
  ])), null);
});

test("parseLegs: rejects a malformed date", () => {
  assert.equal(parseLegs(JSON.stringify([
    { origin: "SFO", destination: "KIX", date: "07/10/2027" },
    { origin: "KIX", destination: "BKK", date: "2027-07-12" },
  ])), null);
});

test("parseLegs: rejects a leg where origin equals destination", () => {
  assert.equal(parseLegs(JSON.stringify([
    { origin: "SFO", destination: "SFO", date: "2027-07-10" },
    { origin: "SFO", destination: "BKK", date: "2027-07-12" },
  ])), null);
});

test("parseLegs: rejects legs that go backward in time", () => {
  assert.equal(parseLegs(JSON.stringify([
    { origin: "SFO", destination: "KIX", date: "2027-07-12" },
    { origin: "KIX", destination: "BKK", date: "2027-07-10" },
  ])), null);
});

test("parseLegs: accepts the same date across legs (same-day connection)", () => {
  const legs = parseLegs(JSON.stringify([
    { origin: "SFO", destination: "KIX", date: "2027-07-10" },
    { origin: "KIX", destination: "BKK", date: "2027-07-10" },
  ]));
  assert.ok(legs);
});

test("parseLegs: rejects invalid JSON", () => {
  assert.equal(parseLegs("not json"), null);
});

test("parseLegs: rejects a non-array JSON value", () => {
  assert.equal(parseLegs(JSON.stringify({ origin: "SFO" })), null);
});

test("parseLegs: rejects empty/missing input", () => {
  assert.equal(parseLegs(""), null);
  assert.equal(parseLegs(null), null);
  assert.equal(parseLegs(undefined), null);
});

/* ---------- buildLegsCacheKey ---------- */

test("buildLegsCacheKey: same legs always produce the same key", () => {
  const legs = [{ origin: "SFO", destination: "KIX", date: "2027-07-10" }, { origin: "KIX", destination: "BKK", date: "2027-07-12" }];
  assert.equal(buildLegsCacheKey(legs, 1, "Economy"), buildLegsCacheKey(legs, 1, "Economy"));
});

test("buildLegsCacheKey: a different via city produces a different key", () => {
  const a = buildLegsCacheKey([{ origin: "SFO", destination: "KIX", date: "2027-07-10" }, { origin: "KIX", destination: "BKK", date: "2027-07-12" }], 1, "Economy");
  const b = buildLegsCacheKey([{ origin: "SFO", destination: "NRT", date: "2027-07-10" }, { origin: "NRT", destination: "BKK", date: "2027-07-12" }], 1, "Economy");
  assert.notEqual(a, b);
});

test("buildLegsCacheKey: is prefixed 'farecache-' so it shares the quota-cache store cleanly", () => {
  const key = buildLegsCacheKey([{ origin: "SFO", destination: "KIX", date: "2027-07-10" }, { origin: "KIX", destination: "BKK", date: "2027-07-12" }], 1, "Economy");
  assert.ok(key.startsWith("farecache-"));
});

test("buildLegsCacheKey: does not collide with a single-route buildFareCacheKey for the same-looking route", () => {
  const legsKey = buildLegsCacheKey([{ origin: "SFO", destination: "KIX", date: "2027-07-10" }, { origin: "KIX", destination: "BKK", date: "2027-07-12" }], 1, "Economy");
  const routeKey = buildFareCacheKey("SFO", "BKK", "2027-07-10", "", 1, "Economy");
  assert.notEqual(legsKey, routeKey);
});

/* ---------- isAllowedOrigin (2026-08-05 abuse-protection backlog item) ---------- */

test("isAllowedOrigin: a matching Origin header is allowed", () => {
  assert.equal(isAllowedOrigin("https://travelintelligence.org", null), true);
});

test("isAllowedOrigin: the www subdomain is allowed", () => {
  assert.equal(isAllowedOrigin("https://www.travelintelligence.org", null), true);
});

test("isAllowedOrigin: a trailing slash on Origin is tolerated", () => {
  assert.equal(isAllowedOrigin("https://travelintelligence.org/", null), true);
});

test("isAllowedOrigin: local dev (netlify dev's default port) is allowed", () => {
  assert.equal(isAllowedOrigin("http://localhost:8888", null), true);
});

test("isAllowedOrigin: an unrelated Origin is rejected even with no Referer", () => {
  assert.equal(isAllowedOrigin("https://evil.example.com", null), false);
});

test("isAllowedOrigin: no Origin header falls back to a matching Referer (the real-world case -- same-origin browser fetch() calls often omit Origin)", () => {
  assert.equal(isAllowedOrigin(null, "https://travelintelligence.org/index.html?foo=bar"), true);
});

test("isAllowedOrigin: an unrelated Referer is rejected", () => {
  assert.equal(isAllowedOrigin(null, "https://some-scraper.example.com/"), false);
});

test("isAllowedOrigin: neither header present is rejected", () => {
  assert.equal(isAllowedOrigin(null, null), false);
  assert.equal(isAllowedOrigin(undefined, undefined), false);
  assert.equal(isAllowedOrigin("", ""), false);
});

test("isAllowedOrigin: a malformed Referer does not throw and is rejected", () => {
  assert.equal(isAllowedOrigin(null, "not a url"), false);
});

test("isAllowedOrigin: Origin takes precedence and a bad Referer alongside a good Origin still passes", () => {
  assert.equal(isAllowedOrigin("https://travelintelligence.org", "not a url"), true);
});

/* ---------- isOverDailyCap / DAILY_SEARCH_CAP ---------- */

test("isOverDailyCap: under the cap is not blocked", () => {
  assert.equal(isOverDailyCap(0), false);
  assert.equal(isOverDailyCap(DAILY_SEARCH_CAP - 1), false);
});

test("isOverDailyCap: exactly at the cap IS blocked (cap is a ceiling on calls made, not a trigger point)", () => {
  assert.equal(isOverDailyCap(DAILY_SEARCH_CAP), true);
});

test("isOverDailyCap: over the cap is blocked", () => {
  assert.equal(isOverDailyCap(DAILY_SEARCH_CAP + 5), true);
});

test("isOverDailyCap: a custom cap argument overrides the default (used by the above tests implicitly via the default param, exercised explicitly here)", () => {
  assert.equal(isOverDailyCap(5, 10), false);
  assert.equal(isOverDailyCap(10, 10), true);
});

/* ---------- todayQuotaKey ---------- */

test("todayQuotaKey: formats as farequota-YYYY-MM-DD in UTC", () => {
  const key = todayQuotaKey(new Date("2026-08-05T23:30:00Z"));
  assert.equal(key, "farequota-2026-08-05");
});

test("todayQuotaKey: two calls the same UTC day produce the same key (so concurrent requests share one counter)", () => {
  const a = todayQuotaKey(new Date("2026-08-05T00:00:01Z"));
  const b = todayQuotaKey(new Date("2026-08-05T23:59:59Z"));
  assert.equal(a, b);
});

test("todayQuotaKey: crossing a UTC day boundary produces a different key (the cap resets, not accumulates forever)", () => {
  const a = todayQuotaKey(new Date("2026-08-05T23:59:59Z"));
  const b = todayQuotaKey(new Date("2026-08-06T00:00:01Z"));
  assert.notEqual(a, b);
});

/* ---------- mapOffers: departTimeRaw/arriveTimeRaw passthrough (2026-08-05,
   audit backlog: wire preferredDepartTime/preferredArrivalTime into real
   scoring — app.js's timeOfDayBucket reads these) ---------- */

test("mapOffers: captures the first segment's departure time and the last segment's arrival time", () => {
  const j = {
    best_flights: [{
      price: 500,
      total_duration: 300,
      flights: [
        { airline: "United", departure_airport: { id: "SFO", time: "2026-10-15 08:20" }, arrival_airport: { id: "ORD", time: "2026-10-15 14:10" } },
        { airline: "United", departure_airport: { id: "ORD", time: "2026-10-15 15:30" }, arrival_airport: { id: "JFK", time: "2026-10-15 18:45" } },
      ],
    }],
    other_flights: [],
  };
  const { offers } = mapOffers(j);
  assert.equal(offers[0].departTimeRaw, "2026-10-15 08:20", "should use the FIRST segment's departure, not a later connection");
  assert.equal(offers[0].arriveTimeRaw, "2026-10-15 18:45", "should use the LAST segment's arrival, not an intermediate one");
});

test("mapOffers: a single-segment (nonstop) offer uses that segment for both times", () => {
  const j = { best_flights: [{ price: 400, flights: [{ airline: "Delta", departure_airport: { time: "2026-10-15 06:00" }, arrival_airport: { time: "2026-10-15 09:00" } }] }], other_flights: [] };
  const { offers } = mapOffers(j);
  assert.equal(offers[0].departTimeRaw, "2026-10-15 06:00");
  assert.equal(offers[0].arriveTimeRaw, "2026-10-15 09:00");
});

test("mapOffers: missing departure_airport/arrival_airport data degrades to null, not a crash", () => {
  const j = { best_flights: [{ price: 400, flights: [{ airline: "Delta" }] }], other_flights: [] };
  const { offers } = mapOffers(j);
  assert.equal(offers[0].departTimeRaw, null);
  assert.equal(offers[0].arriveTimeRaw, null);
});

test("mapOffers: no flights array at all still returns an offer with null times, not a throw", () => {
  const j = { best_flights: [{ price: 400 }], other_flights: [] };
  const { offers } = mapOffers(j);
  assert.equal(offers[0].departTimeRaw, null);
  assert.equal(offers[0].arriveTimeRaw, null);
});

console.log(`\n${passed} passed, 0 failed`);
