// netlify/functions/watch-check.mjs
// version: 1 (2026-07-19)
// Daily scheduled re-search for watched trips — the half of the fare
// watcher that "does the watching" the Purchase Strategy used to
// outsource to the user. Runs once a day at 14:00 UTC (morning US),
// spends AT MOST one SerpApi search per watched trip (≤3), skips trips
// checked in the last 20h (idempotent on retries) and trips whose
// departure has passed. It records the LIVE FARE FLOOR (cheapest offer's
// total price + carrier) — not the engine's weighted winner, which is
// computed client-side; the Watched Trips card labels it exactly that
// way. History capped at 30 checks per trip.

import { getStore } from "@netlify/blobs";

export const config = { schedule: "0 14 * * *" };

export default async () => {
  const key = process.env.SERPAPI_KEY;
  if (!key) return new Response("not configured", { status: 200 }); // scheduled fn: never crash, just no-op

  const store = getStore({ name: "watched-trips", consistency: "strong" });
  const trips = (await store.get("list", { type: "json" })) || [];
  if (!trips.length) return new Response("no trips", { status: 200 });

  const now = Date.now();
  const CABIN_CLASS = { Economy: "1", "Premium Economy": "2", Business: "3", First: "4" };
  let searched = 0;

  for (const trip of trips.slice(0, 3)) {
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
