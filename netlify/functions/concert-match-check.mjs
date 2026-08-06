// netlify/functions/concert-match-check.mjs
// version: 1 (2026-08-06)
//
// Weekly scheduled check for NEW Concert Radar matches on watched trips —
// per Susan's direct request ("this feature needs to also have a weekly
// check for new matches if you didn't already implement that"). It didn't
// exist: checkConcertMatches() in index.html is real and working (see
// CLAUDE.md's Incident #4), but it's 100% client-side, fire-and-forget,
// on-page-visit-only — if Susan never reopens either site, a newly
// announced show near a watched trip is never surfaced at all. This adds
// the server-side half: a weekly sweep of every watched trip against
// Vinyl Scout's /api/artists-playing (the exact same endpoint the live
// client-side check already calls), recording which artists are matching
// and — the actual point of this file — which ones are matching for the
// FIRST TIME since the last sweep, so the next visit's UI can say "new
// this week" instead of presenting the same match as if it were just
// discovered, every single time.
//
// Why this doesn't replace the live client-side check: that one is more
// accurate (real-time, not up-to-a-week stale) and already ships. This is
// additive — it answers "did anything change since I last looked," which
// the live check alone can't, because it has no memory between visits.
//
// No email/push here, on purpose — watch.mjs's own header comment already
// states the standing decision for this whole project: "Alerts are in-app
// deltas...; email/push would need a new credential and is deliberately
// not wired." This follows that same rule. The delta shows up the next
// time Susan opens either site, via watched-trips.mjs's newMatches field
// (see that file's 2026-08-06 update) — same pattern watch-check.mjs
// already established for fare-price deltas.
//
// Runs Monday 12:00 UTC — before watch-check.mjs's daily 14:00 UTC fare
// check, same 'watched-trips' store read (read-only here), separate
// 'concert-match-log' store for this file's own state so a bug here can
// never touch fare-watching data (same store-isolation discipline as
// vinyl-scout-repo's watching.mjs). Same "never crash, always no-op
// cleanly" rule as every other scheduled function in this repo.

import { getStore } from "@netlify/blobs";
import { CITY_COORDS } from "./lib/city-coords.mjs";

export const config = { schedule: "0 12 * * 1" };

// Normalizes an artist name into a stable dedup/lookup key. Exported so
// watched-trips.mjs (which reads this file's stored output) and the test
// suite both key the same way this file writes.
export function matchKey(artist) {
  return String(artist || "").trim().toLowerCase();
}

// Pure: given the PREVIOUS stored state for a trip (or null/undefined on
// first run) and the CURRENT list of matches from artists-playing.mjs,
// compute the next state to store plus which artists are new this run.
// No Blobs, no network — fully unit-testable, same shape as watch.mjs's
// planAddTrip/planRemoveTrip.
export function computeMatchUpdate(prev, matches, nowIso) {
  const prevFirstSeenAt = (prev && prev.firstSeenAt) || {};
  const nextFirstSeenAt = { ...prevFirstSeenAt };
  const newThisWeek = [];
  const seenKeys = new Set();
  for (const m of matches || []) {
    const k = matchKey(m && m.artist);
    if (!k || seenKeys.has(k)) continue; // skip blanks and same-artist duplicate shows within one run
    seenKeys.add(k);
    if (!nextFirstSeenAt[k]) {
      nextFirstSeenAt[k] = nowIso;
      newThisWeek.push(m.artist);
    }
  }
  return {
    lastMatches: matches || [],
    firstSeenAt: nextFirstSeenAt,
    newThisWeek,
    lastCheckedAt: nowIso,
  };
}

// Pure: resolves a trip's destination to [lat, lon] the same way
// watched-trips.mjs's buildWatchedTripsView() does — destIata first
// (what watch.mjs actually stores), destination name as a fallback for
// any older/odd trip record. Returns null for an unmapped destination
// rather than guessing, same honesty rule as the rest of this feature.
export function resolveTripCoords(trip, cityCoords) {
  if (!trip) return null;
  const byCode = trip.destIata ? cityCoords[String(trip.destIata).toLowerCase()] : null;
  if (byCode) return byCode;
  const byName = trip.destination ? cityCoords[String(trip.destination).toLowerCase()] : null;
  return byName || null;
}

export default async () => {
  const tripsStore = getStore({ name: "watched-trips", consistency: "strong" });
  const matchStore = getStore({ name: "concert-match-log", consistency: "strong" });

  const trips = (await tripsStore.get("list", { type: "json" })) || [];
  if (!trips.length) return new Response("no trips", { status: 200 });

  const now = new Date().toISOString();
  let checked = 0;

  for (const trip of trips) {
    if (!trip || !trip.id) continue;
    if (trip.departDate && Date.parse(trip.departDate + "T23:59:00Z") < Date.now()) continue; // trip already happened — nothing to warn about

    const coords = resolveTripCoords(trip, CITY_COORDS);
    if (!coords) continue; // unmapped destination — same as watched-trips.mjs, never guess

    try {
      const u = new URL("https://vinylscout.org/api/artists-playing");
      u.searchParams.set("lat", coords[0]);
      u.searchParams.set("lon", coords[1]);
      u.searchParams.set("date_start", trip.departDate);
      u.searchParams.set("date_end", trip.returnDate || trip.departDate);
      const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const matches = Array.isArray(j.matches) ? j.matches : [];

      const prev = await matchStore.get(trip.id, { type: "json" });
      const next = computeMatchUpdate(prev, matches, now);
      await matchStore.setJSON(trip.id, next);
      checked++;
    } catch (e) { /* one bad trip never blocks the others — same discipline as watch-check.mjs */ }
  }

  return new Response(`checked ${checked} of ${trips.length} trips`, { status: 200 });
};
