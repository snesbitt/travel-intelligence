// tests/scan.test.mjs — pure-function coverage for the deep-scan feed.
// No network, no blobs (scan-offers.mjs imports @netlify/blobs dynamically
// inside the handler, same pattern as fares.mjs).
import assert from "node:assert/strict";
import { sanitizeScan, SCAN_TTL_H } from "../netlify/functions/scan-offers.mjs";

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("sanitizeScan: a valid Kayak scan round-trips with rounded prices", () => {
  const rec = sanitizeScan({ routeKey: "SFO-GBE-2026-09-12-2026-09-24", source: "Kayak",
    offers: [{ carrier: "British Airways", priceTotal: 1799.6, stops: 2, durationMinutes: 1750 }] });
  assert.ok(rec);
  assert.equal(rec.offers.length, 1);
  assert.equal(rec.offers[0].priceTotal, 1800);
  assert.equal(rec.source, "Kayak");
  assert.ok(rec.scannedAt);
});

test("sanitizeScan: one-way route keys are accepted", () => {
  assert.ok(sanitizeScan({ routeKey: "SFO-BNA-2026-09-01", source: "Booking.com",
    offers: [{ carrier: "United", priceTotal: 250, stops: 0, durationMinutes: 260 }] }));
});

test("sanitizeScan: bad route keys, unknown sources, and junk offers are rejected", () => {
  assert.equal(sanitizeScan({ routeKey: "SFOGBE", source: "Kayak", offers: [{ carrier: "X", priceTotal: 1 }] }), null);
  assert.equal(sanitizeScan({ routeKey: "SFO-GBE-2026-09-12", source: "Expedia", offers: [{ carrier: "X", priceTotal: 1 }] }), null);
  assert.equal(sanitizeScan({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers: [{ carrier: "", priceTotal: 0 }] }), null);
  assert.equal(sanitizeScan({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers: [] }), null);
  assert.equal(sanitizeScan(null), null);
});

test("sanitizeScan: offers are capped at 12 and negative/NaN prices dropped", () => {
  const offers = Array.from({ length: 20 }, (_, i) => ({ carrier: "C" + i, priceTotal: i === 0 ? -5 : 100 + i, stops: 1 }));
  const rec = sanitizeScan({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers });
  assert.ok(rec.offers.length <= 12);
  assert.ok(rec.offers.every((o) => o.priceTotal > 0));
});

test("SCAN_TTL_H is 24 — frontend freshness window matches the documented contract", () => {
  assert.equal(SCAN_TTL_H, 24);
});

console.log("\n" + passed + " passed");
