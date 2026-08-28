#!/usr/bin/env node
// scripts/smoke.mjs
//
// A lightweight post-deploy smoke test for the live Netlify Functions.
// check-deploy-fresh.mjs already confirms the static pages are the right
// bytes; nothing confirmed the FUNCTIONS were actually responding at all
// (a working page can still sit in front of a 502'd backend, exactly
// the failure class this repo's CLAUDE.md calls "Incident #2" and the
// one item 1's netlify.toml fix above addresses for watched-trips.mjs
// specifically -- this is the general safety net for the other five).
//
// Written 2026-08-28. Every check below hits a SAFE, side-effect-free
// path: a documented health-ping (fares.mjs's own ?ping=1 convention) or
// a plain GET that only reads. Two of this repo's six functions are
// deliberately SKIPPED, not pinged:
//
//   - watch-check.mjs and netlify/functions/concert-match-check.mjs are
//     schedule-only (export const config = { schedule: ... }, no
//     config.path). Invoking either directly would run a REAL SerpApi
//     search / Blobs write, not a safe read -- exactly what this smoke
//     test exists to avoid triggering. There is no ping-only mode for
//     either today; if one is ever added, it belongs here too.
//
// Exit 0 on all-clear, exit 1 naming exactly which function(s) failed
// and how.
//
// Usage: node scripts/smoke.mjs [--json]

const BASE_URL = (process.env.SMOKE_BASE_URL || "https://travelintelligence.org").replace(/\/+$/, "");
const JSON_OUT = process.argv.includes("--json");

const CHECKS = [
  {
    name: "fares.mjs",
    path: "/api/fares?ping=1",
    // Documented health-ping path (see fares.mjs's own `if (url.searchParams.get("ping"))`
    // branch, checked before the SerpApi key / origin guards) -- never
    // touches SerpApi, never spends quota.
    validate: (j) => typeof j.live === "boolean",
  },
  {
    name: "watch.mjs",
    path: "/api/watch",
    // GET is intentionally public (only POST/DELETE are gated by
    // checkWriteAuth, see watch.mjs's v4 header comment) -- a plain read.
    validate: (j) => Array.isArray(j.trips),
  },
  {
    name: "watched-trips.mjs",
    path: "/api/watched-trips",
    // GET-only by design (this whole file is a read-only privacy-scoped
    // view, see its own header comment) -- there is no write path to
    // accidentally trigger here.
    validate: (j) => Array.isArray(j.trips),
  },
  {
    name: "scan-offers.mjs",
    // A syntactically valid but real-world-unlikely route key. GET never
    // writes; a miss just returns an empty scans array, which is still a
    // valid 200 proving the function responded.
    path: "/api/scan-offers?key=ZZZ-ZZZ-2099-01-01",
    validate: (j) => Array.isArray(j.scans),
  },
];

async function checkOne(check) {
  const url = BASE_URL + check.path;
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) return { ...check, status: "fail", detail: "HTTP " + res.status };
    let body;
    try {
      body = await res.json();
    } catch (e) {
      return { ...check, status: "fail", detail: "response was not valid JSON" };
    }
    if (!check.validate(body)) {
      return { ...check, status: "fail", detail: "response JSON did not match the expected shape: " + JSON.stringify(body).slice(0, 200) };
    }
    return { ...check, status: "ok" };
  } catch (e) {
    return { ...check, status: "fail", detail: e.message };
  }
}

const results = await Promise.all(CHECKS.map(checkOne));
const failed = results.filter((r) => r.status === "fail");

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, baseUrl: BASE_URL, results }, null, 2));
} else if (!failed.length) {
  console.log("Smoke test passed: all " + results.length + " checked functions responded (" + results.map((r) => r.name).join(", ") + "). Skipped watch-check.mjs and concert-match-check.mjs (schedule-only, no safe read-only path).");
} else {
  console.error("Smoke test FAILED for " + BASE_URL + "\n");
  for (const r of failed) console.error("  " + r.name + " (" + r.path + "): " + r.detail);
  const ok = results.filter((r) => r.status === "ok");
  if (ok.length) console.error("\n  (" + ok.map((r) => r.name).join(", ") + " responded fine.)");
}
process.exit(failed.length ? 1 : 0);
