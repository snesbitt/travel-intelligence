// netlify/functions/watch-check.mjs
// version: 1 (2026-07-19)
// Daily scheduled re-search for watched trips — the half of the fare
// watcher that "does the watching" the Purchase Strategy used to
// outsource to the user. Runs once a day at 14:00 UTC (morning US),
// spends AT MOST one SerpApi search per watched trip (≤2), skips trips
// checked in the last 20h (idempotent on retries) and trips whose
// departure has passed. It records the LIVE FARE FLOOR (cheapest offer's
// total price + carrier) — not the engine's weighted winner, which is
// computed client-side; the Watched Trips card labels it exactly that
// way. History capped at 30 checks per trip.

import { getStore } from "@netlify/blobs";

export const config = { schedule: "0 14 * * *" };

export default async () => {
  const store = getStore({ name: "watched-trips", consistency: "strong" });

  // Health check (sibling-site parity, kept radically simple): ping our
  // own fares backend and record the result. The frontend stays silent
  // when healthy and warns only when the last check failed.
  try {
    const site = process.env.URL || "https://travelintelligence.org";
    const r = await fetch(site + "/api/fares?ping=1");
    const j = r.ok ? await r.json() : {};
    await store.setJSON("health", { at: new Date().toISOString(), ok: Boolean(r.ok && j.live), live: Boolean(j.live) });
  } catch (e) {
    await store.setJSON("health", { at: new Date().toISOString(), ok: false, live: false });
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) return new Response("not configured", { status: 200 }); // scheduled fn: never crash, just no-op

  const trips = (await store.get("list", { type: "json" })) || [];

  // Daily backup of the watched-trips list (sibling-site parity), keep 7.
  try {
    const day = new Date().toISOString().slice(0, 10);
    await store.setJSON("backup-" + day, trips);
    const { blobs } = await store.list({ prefix: "backup-" });
    const old = blobs.map((b) => b.key).sort().slice(0, -7);
    for (const k of old) await store.delete(k);
  } catch (e) { /* backup failure never blocks the checks */ }

  if (!trips.length) return new Response("no trips", { status: 200 });

  const now = Date.now();
  const CABIN_CLASS = { Economy: "1", "Premium Economy": "2", Business: "3", First: "4" };
  let searched = 0;
  const MAX_TRIPS = 3; // must match watch.mjs's MAX_TRIPS — that file is the source of truth (raised 2026-07-26, Susan)

  for (const trip of trips.slice(0, MAX_TRIPS)) {
    const last = trip.checks && trip.checks.length ? Date.parse(trip.checks[trip.checks.length - 1].at) : 0;
    if (now - last < 20 * 3600 * 1000) continue;               // already checked today
    if (Date.parse(trip.departDate + "T23:59:00Z") < now) continue; // trip departed

    const q = new URLSearchParams({
      engine: "google_flights",
      departure_id: trip.originIata, arrival_id: trip.destIata,
      outbound_date: trip.departDate,
      adults: String(trip.travelers || 1),
      currency: "USD", hl: "en", api_key: key,
    });
    if (trip.returnDate) { q.set("return_date", trip.returnDate); q.set("type", "1"); } else { q.set("type", "2"); }
    if (CABIN_CLASS[trip.cabin]) q.set("travel_class", CABIN_CLASS[trip.cabin]);

    try {
      const res = await fetch("https://serpapi.com/search?" + q);
      if (!res.ok) continue;
      const j = await res.json();
      const raw = [...(j.best_flights || []), ...(j.other_flights || [])].filter((o) => o.price);
      if (!raw.length) continue;
      searched++;
      const cheapest = raw.reduce((m, o) => (o.price < m.price ? o : m), raw[0]);
      const carrier = ((cheapest.flights || [])[0] || {}).airline || "";
      trip.checks = trip.checks || [];
      trip.checks.push({ at: new Date().toISOString(), price: Math.round(cheapest.price), carrier });
      if (trip.checks.length > 30) trip.checks = trip.checks.slice(-30);
    } catch (e) { /* one bad trip never blocks the others */ }
  }

  await store.setJSON("list", trips);
  return new Response(`checked ${searched} trips`, { status: 200 });
};
