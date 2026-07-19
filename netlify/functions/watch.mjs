// netlify/functions/watch.mjs
// version: 1 (2026-07-19)
// The fare watcher's storage API — the audit's "one big bet." Watched
// trips persist in a Netlify Blobs store; watch-check.mjs re-searches
// them on a daily schedule. Capped at MAX_TRIPS=3 because each watched
// trip spends one SerpApi search per day (~90/month at the cap, inside
// the 250/month free tier alongside manual runs) — raising the cap is a
// quota/spend decision that belongs to Susan, per CLAUDE.md. Alerts are
// in-app deltas (the homepage Watched Trips card); email/push would need
// a new credential and is deliberately not wired.
// Same open POST/DELETE model as streaming-scout's dismiss.mjs — no auth,
// nothing sensitive stored (routes and dates only, never wallet data).

import { getStore } from "@netlify/blobs";

const MAX_TRIPS = 3;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/watch" };

export default async (req) => {
  // strong consistency: a GET right after a watch/unwatch must reflect it
  // (default eventual consistency made the card vanish on quick reloads)
  const store = getStore({ name: "watched-trips", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const trips = (await store.get("list", { type: "json" })) || [];
    return json({ trips, max: MAX_TRIPS });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "Invalid JSON body" }, 400); }
    const t = body && body.trip;
    if (!t || !/^[A-Z]{3}$/.test(t.originIata || "") || !/^[A-Z]{3}$/.test(t.destIata || "") || !/^\d{4}-\d{2}-\d{2}$/.test(t.departDate || "")) {
      return json({ error: "trip needs originIata, destIata (3-letter codes) and departDate (YYYY-MM-DD)" }, 400);
    }
    const trips = (await store.get("list", { type: "json" })) || [];
    const id = [t.originIata, t.destIata, t.departDate, t.cabin || "Economy"].join("|");
    if (trips.some((x) => x.id === id)) return json({ ok: true, trips, note: "already watching" });
    if (trips.length >= MAX_TRIPS) {
      return json({ error: `Watch cap is ${MAX_TRIPS} trips (each costs one live search per day — quota discipline). Stop watching one first.` }, 409);
    }
    trips.push({
      id,
      originIata: t.originIata, destIata: t.destIata,
      origin: String(t.origin || t.originIata).slice(0, 60), destination: String(t.destination || t.destIata).slice(0, 60),
      departDate: t.departDate, returnDate: /^\d{4}-\d{2}-\d{2}$/.test(t.returnDate || "") ? t.returnDate : null,
      cabin: ["Economy", "Premium Economy", "Business", "First", "Best Value"].includes(t.cabin) ? t.cabin : "Economy",
      travelers: Math.min(9, Math.max(1, parseInt(t.travelers, 10) || 1)),
      createdAt: new Date().toISOString(),
      baseline: t.baseline && typeof t.baseline.price === "number" ? { price: Math.round(t.baseline.price), carrier: String(t.baseline.carrier || "").slice(0, 60), at: new Date().toISOString() } : null,
      checks: [], // appended by watch-check.mjs, newest last, capped at 30
    });
    await store.setJSON("list", trips);
    return json({ ok: true, trips });
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    const trips = (await store.get("list", { type: "json" })) || [];
    const next = trips.filter((x) => x.id !== id);
    await store.setJSON("list", next);
    return json({ ok: true, trips: next });
  }

  return json({ error: "Method not allowed" }, 405);
};
