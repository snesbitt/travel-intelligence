#!/usr/bin/env node
// scripts/check-integrity.mjs
//
// An independent, READ-ONLY daily check on the watched-trips fare-watcher
// state, following the same "good day / bad day" shape Vinyl Scout's own
// integrity check uses: exactly two outcomes, a plain "everything's fine"
// summary or a specific, named problem, nothing in between.
//
// Written 2026-08-28 because the only thing resembling a "check" of this
// data was living inside netlify/functions/watch-check.mjs itself -- the
// same function that WRITES the health record and rotates the 7-day
// Blobs backup also being the only thing that ever looks at whether that
// write/rotation is actually healthy. A write path that grades its own
// homework misses the case where the write path itself silently stops
// running (a cron that stops firing, a deploy that breaks the schedule)
// -- there'd be nothing left to notice. This script has no write path
// of its own to protect it from that blind spot.
//
// SCOPE, stated honestly rather than overclaimed: this repo has no
// Netlify Blobs credential available outside a live Netlify Function (no
// NETLIFY_AUTH_TOKEN/site-ID secret exists in this repo, and per Susan's
// standing "no new secret" rule for scheduled checks, this script does
// not add one). So it cannot read the watched-trips Blobs store or the
// backup-YYYY-MM-DD rotation directly. Instead it checks the two things
// that ARE observable over plain HTTPS, both already-public GET
// endpoints, no credential of any kind:
//
//   1. GET /api/watch (public: GET is unauthenticated on watch.mjs,
//      only POST/DELETE are gated) -- returns {trips, max, health}.
//      `health` is the exact record watch-check.mjs writes on every
//      invocation, right before it does the day's backup rotation in
//      the SAME run. A fresh, ok `health.at` is therefore the closest
//      available proxy for "the daily job (and the backup rotation
//      alongside it) is actually still running" that doesn't require
//      Blobs credentials this script doesn't have.
//   2. GET /api/watched-trips (public, privacy-scoped read of the same
//      underlying store) -- cross-checked for the same trip count as
//      /api/watch, catching the two views drifting apart (e.g. one
//      endpoint's 502, or the committed match-log path silently
//      returning something malformed).
//
// This is NOT a substitute for direct Blobs inspection of the backup
// rotation -- if that's ever needed, it needs a real Netlify Blobs
// credential wired in deliberately, a decision for Susan, not something
// to slip in via a "READ-ONLY check" side door.
//
// Exit 0 + a "GOOD DAY" summary on success. Exit 1 + a specific "BAD DAY"
// problem description on failure. Never writes anything, anywhere.
//
// Usage: node scripts/check-integrity.mjs [--json]

const BASE_URL = (process.env.INTEGRITY_BASE_URL || "https://travelintelligence.org").replace(/\/+$/, "");
const JSON_OUT = process.argv.includes("--json");

// Health should be written once per day (watch-check.mjs, 14:00 UTC
// cron); 30h gives a full extra cycle of slack before calling it stale,
// same order-of-magnitude slack check-deploy-fresh.mjs's own --wait
// window uses for "give the pipeline a beat before crying wolf."
const HEALTH_MAX_AGE_H = 30;

async function getJSON(path) {
  const url = BASE_URL + path;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return await res.json();
}

const problems = [];

let watch, watchedTrips;
try {
  watch = await getJSON("/api/watch");
} catch (e) {
  problems.push("GET /api/watch failed: " + e.message);
}
try {
  watchedTrips = await getJSON("/api/watched-trips");
} catch (e) {
  problems.push("GET /api/watched-trips failed: " + e.message);
}

if (watch) {
  if (!Array.isArray(watch.trips)) {
    problems.push("/api/watch returned a non-array `trips` field: " + JSON.stringify(watch.trips));
  } else if (typeof watch.max === "number" && watch.trips.length > watch.max) {
    problems.push(
      "/api/watch reports " + watch.trips.length + " watched trips, over its own MAX_TRIPS of " + watch.max + " (the watch cap should never be exceeded).",
    );
  }

  if (!watch.health) {
    problems.push("/api/watch has no `health` field at all -- watch-check.mjs may never have run since this Blobs store was created.");
  } else {
    if (watch.health.ok !== true) {
      problems.push("watch-check.mjs's last health check reported ok:false (recorded at " + watch.health.at + ") -- the fares backend it pings was unreachable or misconfigured that run.");
    }
    const ageMs = Date.now() - Date.parse(watch.health.at || "");
    const ageH = ageMs / 3600000;
    if (!Number.isFinite(ageH)) {
      problems.push("/api/watch's health.at is not a parseable timestamp: " + JSON.stringify(watch.health.at));
    } else if (ageH > HEALTH_MAX_AGE_H) {
      problems.push(
        "watch-check.mjs's last recorded health check is " + ageH.toFixed(1) + "h old (over the " + HEALTH_MAX_AGE_H + "h freshness window) -- the daily scheduled job, and the backup rotation that runs alongside it in the same invocation, may have stopped firing.",
      );
    }
  }
}

if (watch && watchedTrips) {
  if (Array.isArray(watch.trips) && Array.isArray(watchedTrips.trips) && watch.trips.length !== watchedTrips.trips.length) {
    problems.push(
      "/api/watch reports " + watch.trips.length + " watched trips but /api/watched-trips's privacy-scoped view reports " + watchedTrips.trips.length + " -- the two reads of the same store disagree.",
    );
  }
}

const ok = problems.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), problems, watch: watch ? { tripCount: watch.trips && watch.trips.length, max: watch.max, health: watch.health } : null }, null, 2));
} else if (ok) {
  const tripCount = watch && Array.isArray(watch.trips) ? watch.trips.length : "unknown";
  const healthAge = watch && watch.health ? ((Date.now() - Date.parse(watch.health.at)) / 3600000).toFixed(1) + "h" : "unknown";
  console.log(
    "GOOD DAY: watched-trips integrity check passed. " + tripCount + " watched trip(s), last health check " + healthAge + " old and healthy, /api/watch and /api/watched-trips agree on trip count.",
  );
} else {
  console.error("BAD DAY: watched-trips integrity check FAILED\n");
  for (const p of problems) console.error("  - " + p);
}

process.exit(ok ? 0 : 1);
