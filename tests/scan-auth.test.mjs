// tests/scan-auth.test.mjs
// Regression suite for scan-offers.mjs's write-auth gate (2026-08-28),
// added to close the same gap watch.mjs's v4 pass (2026-08-08) closed
// there: POST previously accepted writes from anyone. Same shape as
// tests/watch-auth.test.mjs -- only the unauthorized-write paths are
// exercised here (missing key, wrong key on POST), which return a 401
// before the handler's dynamic `await import("@netlify/blobs")` /
// getStore() ever run, so this runs cleanly in a bare Node process with
// no Netlify Blobs context configured. The authorized-write and GET
// paths both eventually reach getStore(), which needs a real Netlify
// Blobs environment to not throw -- exercising those isn't attempted
// here, same "never mock Blobs" convention as tests/watch-auth.test.mjs.
//
// Run: node tests/scan-auth.test.mjs (wired into `npm test`).
// EDIT_SECRET is set in-process below so this also runs plain with no
// env setup needed.

import assert from "node:assert/strict";
import handler, { checkWriteAuth } from "../netlify/functions/scan-offers.mjs";

process.env.EDIT_SECRET = process.env.EDIT_SECRET || "test-secret-for-ci";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}
async function atest(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

/* ---------- checkWriteAuth, the pure function directly ---------- */

test("checkWriteAuth: correct key matches EDIT_SECRET returns true", () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers", {
    headers: { "X-Edit-Key": "test-secret-for-ci" },
  });
  assert.equal(checkWriteAuth(req), true);
});

test("checkWriteAuth: missing header returns false", () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers");
  assert.equal(checkWriteAuth(req), false);
});

test("checkWriteAuth: wrong key returns false", () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers", {
    headers: { "X-Edit-Key": "definitely-not-it" },
  });
  assert.equal(checkWriteAuth(req), false);
});

/* ---------- full handler, unauthorized paths (no Blobs env needed) ---------- */

await atest("POST with no X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers: [{ carrier: "X", priceTotal: 100 }] }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("POST with the wrong X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Key": "definitely-not-it" },
    body: JSON.stringify({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers: [{ carrier: "X", priceTotal: 100 }] }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("POST fails closed (401) when EDIT_SECRET env var is unset, even with a key supplied", async () => {
  const saved = process.env.EDIT_SECRET;
  delete process.env.EDIT_SECRET;
  const req = new Request("https://travelintelligence.org/api/scan-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Key": "anything-at-all" },
    body: JSON.stringify({ routeKey: "SFO-GBE-2026-09-12", source: "Kayak", offers: [{ carrier: "X", priceTotal: 100 }] }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
  process.env.EDIT_SECRET = saved;
});

await atest("401 response carries a JSON {error: string} body, not an empty response", async () => {
  const req = new Request("https://travelintelligence.org/api/scan-offers", { method: "POST" });
  const res = await handler(req);
  const body = await res.json();
  assert.equal(typeof body.error, "string");
});

await atest("GET stays public, no auth required, unaffected by the gate", async () => {
  // GET reaches getStore() via the dynamic import, which throws without a
  // real Netlify Blobs environment configured (no siteID/token in this
  // bare test process). The point of this test is only that GET is never
  // rejected with a 401 by the auth gate itself.
  const req = new Request("https://travelintelligence.org/api/scan-offers?key=SFO-GBE-2026-09-12", { method: "GET" });
  try {
    const res = await handler(req);
    assert.notEqual(res.status, 401, "GET must never be rejected by the write-auth gate");
  } catch (e) {
    assert.ok(!/unauthorized/i.test(e.message || ""), "a GET failure must not be an auth rejection");
  }
});

console.log(`\n${passed} passed`);
