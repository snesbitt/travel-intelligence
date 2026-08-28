#!/usr/bin/env node
// scripts/concert-match-check.mjs
// GitHub Actions replacement for netlify/functions/concert-match-check.mjs.
// Zero new secrets: both endpoints called are already public reads
// (this site's /api/watched-trips, Vinyl Scout's /api/artists-playing).
// Additive alongside the existing Netlify-scheduled version.
// matchKey/computeMatchUpdate copied verbatim from the Netlify function.

const WATCHED_TRIPS_URL = process.env.MATCH_CHECK_WATCHED_TRIPS_URL || 'https://travelintelligence.org/api/watched-trips';
const ARTISTS_PLAYING_BASE = process.env.MATCH_CHECK_ARTISTS_PLAYING_URL || 'https://vinylscout.org/api/artists-playing';
const OUTPUT_PATH = 'data/concert-match-log.json';

export function matchKey(artist) {
  return String(artist || '').trim().toLowerCase();
}

export function computeMatchUpdate(prev, matches, nowIso) {
  const prevFirstSeenAt = (prev && prev.firstSeenAt) || {};
  const nextFirstSeenAt = Object.assign({}, prevFirstSeenAt);
  const newThisWeek = [];
  const seenKeys = new Set();
  for (const m of matches || []) {
    const k = matchKey(m && m.artist);
    if (!k || seenKeys.has(k)) continue;
    seenKeys.add(k);
    if (!nextFirstSeenAt[k]) {
      nextFirstSeenAt[k] = nowIso;
      newThisWeek.push(m.artist);
    }
  }
  return {
    lastMatches: matches || [],
    firstSeenAt: nextFirstSeenAt,
    newThisWeek: newThisWeek,
    lastCheckedAt: nowIso,
  };
}

// Small bounded retry around a single external fetch: up to 3 attempts
// total, short fixed backoff between them. Same fix and same reasoning
// as watch-check.mjs's fetchWithRetry (2026-08-28): this script's two
// external calls (this site's own /api/watched-trips, Vinyl Scout's
// /api/artists-playing) previously failed the whole trip (or the whole
// run, for the watched-trips call) on a single transient blip, when a
// second attempt one beat later would likely have succeeded.
//
// timeoutMs (optional) gets its OWN fresh AbortController per attempt --
// deliberately not a single AbortSignal passed in from the caller, which
// would abort once and poison every retry after it (an aborted signal
// stays aborted; a second fetch given the same signal fails instantly,
// defeating the retry). Callers that need a per-call timeout pass
// timeoutMs instead of building their own AbortController.
async function fetchJSON(url, opts, attempts, delayMs) {
  opts = opts || {};
  attempts = attempts || 3;
  delayMs = delayMs || 500;
  const timeoutMs = opts.timeoutMs;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let controller, timeout;
    const fetchOpts = { ...opts };
    delete fetchOpts.timeoutMs;
    if (timeoutMs) {
      controller = new AbortController();
      fetchOpts.signal = controller.signal;
      timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
    }
    try {
      const res = await fetch(url, fetchOpts);
      if (res.ok) return await res.json();
      lastErr = new Error('GET ' + url + ' failed: HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (i < attempts - 1) await new Promise(function (r) { setTimeout(r, delayMs); });
  }
  throw lastErr;
}

async function loadPreviousState() {
  const fs = await import('node:fs/promises');
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

async function main() {
  const watchedTripsResp = await fetchJSON(WATCHED_TRIPS_URL);
  const trips = Array.isArray(watchedTripsResp.trips) ? watchedTripsResp.trips : null;
  if (!trips) throw new Error('/api/watched-trips did not return a trips array');

  const prevAll = await loadPreviousState();
  const nowIso = new Date().toISOString();
  const nextAll = {};
  let checked = 0, skippedDeparted = 0, skippedUnmapped = 0;

  for (const trip of trips) {
    if (!trip || !trip.id) continue;
    if (trip.dateStart && Date.parse(trip.dateStart + 'T23:59:00Z') < Date.now()) {
      skippedDeparted++;
      // Carry the previous entry forward unchanged, same as the
      // fetch-error branch below -- a departed trip is still skipped
      // (nothing to warn about, per the Netlify original's identical
      // early-continue), but "skipped" must not mean "erased": without
      // this, firstSeenAt/lastMatches/newThisWeek for that trip id
      // vanish from nextAll the very next run, wiping match history a
      // trip that departs mid-week never needed to lose.
      if (prevAll[trip.id]) nextAll[trip.id] = prevAll[trip.id];
      continue;
    }
    if (typeof trip.lat !== 'number' || typeof trip.lon !== 'number') {
      skippedUnmapped++;
      // Same carry-forward, same reasoning: an unmapped destination is a
      // data gap, not a signal that this trip's prior match history
      // should be discarded.
      if (prevAll[trip.id]) nextAll[trip.id] = prevAll[trip.id];
      continue;
    }
    try {
      const u = new URL(ARTISTS_PLAYING_BASE);
      u.searchParams.set('lat', trip.lat);
      u.searchParams.set('lon', trip.lon);
      u.searchParams.set('date_start', trip.dateStart);
      u.searchParams.set('date_end', trip.dateEnd || trip.dateStart);
      const j = await fetchJSON(u.toString(), { timeoutMs: 8000 });
      const matches = Array.isArray(j.matches) ? j.matches : [];
      const next = computeMatchUpdate(prevAll[trip.id], matches, nowIso);
      nextAll[trip.id] = next;
      checked++;
    } catch (e) {
      if (prevAll[trip.id]) nextAll[trip.id] = prevAll[trip.id];
      console.warn('trip ' + trip.id + ' failed, carrying forward:', e.message);
    }
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(nextAll, null, 2) + '\n', 'utf-8');
  console.log('checked ' + checked + ' of ' + trips.length + ' trips (skipped ' + skippedDeparted + ' departed, ' + skippedUnmapped + ' unmapped)');

  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) {
    await fs.appendFile(ghOutput, 'log_path=' + OUTPUT_PATH + '\nchecked_count=' + checked + '\ntrip_count=' + trips.length + '\n', 'utf-8');
  }
}

// Only auto-run when executed directly (node scripts/concert-match-check.mjs
// or via the GitHub Actions workflow) -- not when imported, e.g. by
// tests/concert-match-check.test.mjs for computeMatchUpdate/matchKey.
// Without this guard, importing the module for its pure functions would
// also kick off a real network run and fail the whole test suite outside
// an environment with live API access.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('concert-match-check.mjs failed:', err.message);
    process.exit(1);
  });
}
