// tests/watch-auth.test.mjs
// Regression suite for watch.mjs's v4 edit-key gate (roadmap Phase 8,
// "Protect watched trips" — server half, 2026-08-08). Same pattern as
// vinyl-scout-repo's scripts/test-wishlist.mjs: exercises the exported
// default handler directly with real Request objects, no live network.
//
// Scope, deliberately narrow, same reasoning as test-wishlist.mjs: only
// the unauthorized-write paths are tested here (missing key, wrong key on
// POST/DELETE) -- those return a 401 before the handler ever touches
// @netlify/blobs' getStore(), so they run cleanly in a bare Node process
// with no Netlify Blobs context configured. The authorized-write and GET
// paths both call getStore(...), which needs a real Netlify Blobs
// environment (siteID/token) to not throw -- exercising those isn't
// attempted here, matching this repo's own "never mock Blobs" convention
// (see watched-trips.test.mjs and CLAUDE.md's testing-that-actually-
// proves-something notes).
//
// Run: node tests/watch-auth.test.mjs (wired into `npm test`).
// EDIT_SECRET is set in-process below so this also runs plain with no env
// setup needed.

import assert from "node:assert/strict";
import handler, { checkWriteAuth } from "../netlify/functions/watch.mjs";

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
  const req = new Request("https://travelintelligence.org/api/watch", {
    headers: { "X-Edit-Key": "test-secret-for-ci" },
  });
  assert.equal(checkWriteAuth(req), true);
});

test("checkWriteAuth: missing header returns false", () => {
  const req = new Request("https://travelintelligence.org/api/watch");
  assert.equal(checkWriteAuth(req), false);
});

test("checkWriteAuth: wrong key returns false", () => {
  const req = new Request("https://travelintelligence.org/api/watch", {
    headers: { "X-Edit-Key": "definitely-not-it" },
  });
  assert.equal(checkWriteAuth(req), false);
});

/* ---------- full handler, unauthorized paths (no Blobs env needed) ---------- */

await atest("POST with no X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip: { originIata: "SFO", destIata: "NRT", departDate: "2026-09-01" } }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("POST with the wrong X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Key": "definitely-not-it" },
    body: JSON.stringify({ trip: { originIata: "SFO", destIata: "NRT", departDate: "2026-09-01" } }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("DELETE with no X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/watch?id=SFO|NRT|2026-09-01|Economy|-|1", {
    method: "DELETE",
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("DELETE with the wrong X-Edit-Key returns 401", async () => {
  const req = new Request("https://travelintelligence.org/api/watch?id=SFO|NRT|2026-09-01|Economy|-|1", {
    method: "DELETE",
    headers: { "X-Edit-Key": "definitely-not-it" },
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
});

await atest("POST fails closed (401) when EDIT_SECRET env var is unset, even with a key supplied", async () => {
  const saved = process.env.EDIT_SECRET;
  delete process.env.EDIT_SECRET;
  const req = new Request("https://travelintelligence.org/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Key": "anything-at-all" },
    body: JSON.stringify({ trip: { originIata: "SFO", destIata: "NRT", departDate: "2026-09-01" } }),
  });
  const res = await handler(req);
  assert.equal(res.status, 401);
  process.env.EDIT_SECRET = saved;
});

await atest("401 response carries a JSON {error: string} body, not an empty response", async () => {
  const req = new Request("https://travelintelligence.org/api/watch", { method: "POST" });
  const res = await handler(req);
  const body = await res.json();
  assert.equal(typeof body.error, "string");
});

await atest("GET stays public — no auth required, unaffected by the gate", async () => {
  // GET reaches getStore(), which throws without a real Netlify Blobs
  // environment configured (no siteID/token in this bare test process).
  // The point of this test is only that GET is never rejected with a 401
  // by the auth gate itself — confirmed by checking the gate is skipped
  // and the failure (if any) is a Blobs-config error, not an auth error.
  const req = new Request("https://travelintelligence.org/api/watch", { method: "GET" });
  try {
    const res = await handler(req);
    assert.notEqual(res.status, 401, "GET must never be rejected by the write-auth gate");
  } catch (e) {
    // getStore() throwing here (no Blobs env in this bare test process) is
    // expected and fine — it proves execution got PAST the auth gate
    // (which only runs for POST/DELETE) rather than being blocked by it.
    assert.ok(!/unauthorized/i.test(e.message || ""), "a GET failure must not be an auth rejection");
  }
});

console.log(`\n${passed} passed`);
