// tests/fares.test.mjs
// Tests for fares.mjs's quota-protection cache logic (buildFareCacheKey,
// isCacheFresh, CACHE_TTL_MS — added 2026-07-20). Pure functions only, no
// fetch/@netlify/blobs mocking needed: this is the same "export the pure
// logic for testability" pattern vinyl-scout's audio-preview.mjs uses.
// Run via `node tests/fares.test.mjs` (also wired into `npm test`, see
// package.json). No live network calls, no SerpApi key needed.

import assert from "node:assert/strict";
import { buildFareCacheKey, isCacheFresh, CACHE_TTL_MS } from "../netlify/functions/fares.mjs";

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

console.log(`\n${passed} passed, 0 failed`);
