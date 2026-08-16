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

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error('GET ' + url + ' failed: HTTP ' + res.status);
  return await res.json();
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
      continue;
    }
    if (typeof trip.lat !== 'number' || typeof trip.lon !== 'number') {
      skippedUnmapped++;
      continue;
    }
    try {
      const u = new URL(ARTISTS_PLAYING_BASE);
      u.searchParams.set('lat', trip.lat);
      u.searchParams.set('lon', trip.lon);
      u.searchParams.set('date_start', trip.dateStart);
      u.searchParams.set('date_end', trip.dateEnd || trip.dateStart);
      const controller = new AbortController();
      const timeout = setTimeout(function () { controller.abort(); }, 8000);
      let j;
      try {
        j = await fetchJSON(u.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
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

main().catch((err) => {
  console.error('concert-match-check.mjs failed:', err.message);
  process.exit(1);
});
