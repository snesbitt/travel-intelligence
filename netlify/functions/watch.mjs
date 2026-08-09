// netlify/functions/watch.mjs
// version: 4 (2026-08-08)
// The fare watcher's storage API, the audit's "one big bet." Watched
// trips persist in a Netlify Blobs store; watch-check.mjs re-searches
// them on a daily schedule. Capped at MAX_TRIPS=3 because each watched
// trip spends one SerpApi search per day, raising the cap is a
// quota/spend decision that belongs to Susan, per CLAUDE.md. Alerts are
// in-app deltas (the homepage Watched Trips card); email/push would need
// a new credential and is deliberately not wired.
//
// QUOTA MATH (2026-07-26, Susan's explicit request to raise the cap back
// to 3, superseding the 2026-07-20 decision below):
//   - watch-check.mjs runs once/day on a schedule and re-searches each
//     watched trip at most once/day, skipping trips already checked in
//     the last 20h. At the MAX_TRIPS=3 cap that's <=3 searches/day, i.e.
//     <=90 searches/month (3 x ~30 days).
//   - Real free-tier cap: 100 searches/month.
//   - Headroom left for manual "Run the optimization" calls: ~10/month
//     (100 - 90), tight. If manual runs start hitting the monthly limit,
//     the lever is here: drop back to MAX_TRIPS=2 (~40/month headroom)
//     or stretch the check cadence to every-other-day (more headroom,
//     staler watched data), either is a one-line change plus this
//     comment, and either is Susan's call, not something to change
//     without her sign-off.
//   - Prior state (2026-07-20 → 2026-07-26): MAX_TRIPS=2, ~60/month for
//     the watcher, ~40/month headroom. Lowered from 3 at the time because
//     manual-run headroom felt too thin; raised back to 3 now at Susan's
//     request, with the tighter headroom stated plainly above.
//
// v4 (2026-08-08, roadmap Phase 8, "Protect watched trips", server half):
// POST/DELETE are now gated by the same X-Edit-Key / EDIT_SECRET pattern
// vinyl-scout-repo's wishlist.mjs (v4, 2026-08-06) and records.mjs already
// use, see checkWriteAuth() below. GET stays public (browsing/running the
// optimizer was never the risk; watch/unwatch spending a metered daily
// search on a shared store that's open to anyone with the link was). This
// closes a real gap: index.html has sent an X-Edit-Key header on every
// watch/unwatch request since 2026-08-07, but until this version the
// server ignored it entirely, anyone with the site URL could add/remove
// watched trips regardless of whether they had the key. watch-check.mjs
// and watched-trips.mjs both access the Blobs store directly (getStore),
// never through this HTTP handler, so neither is affected by this gate.
import { getStore } from "@netlify/blobs";

export const MAX_TRIPS = 3; // see quota math in the header comment above before changing this

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/watch" };

// Same pattern as wishlist.mjs's checkWriteAuth (vinyl-scout-repo, v4,
// 2026-08-06): fails closed if EDIT_SECRET is unset, a misconfigured
// deploy rejects writes rather than silently accepting them from anyone.
export function checkWriteAuth(req) {
  const expected = process.env.EDIT_SECRET;
  const provided = req.headers.get("x-edit-key");
  return !!(expected && provided && provided === expected);
}

// 2026-08-05: pure request-validation + id-building, split out of the
// handler so it's testable the same "export the pure logic" way
// buildFareCacheKey/parseLegs already are in fares.mjs, no @netlify/blobs
// needed to exercise any of this.
export function validateTripInput(t) {
  if (!t || !/^[A-Z]{3}$/.test(t.originIata || "") || !/^[A-Z]{3}$/.test(t.destIata || "") || !/^\d{4}-\d{2}-\d{2}$/.test(t.departDate || "")) {
    return { error: "trip needs originIata, destIata (3-letter codes) and departDate (YYYY-MM-DD)" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t.returnDate || "") && t.returnDate < t.departDate) {
    return { error: "returnDate is before departDate: a watch with an impossible range can never search real fares" };
  }
  return { ok: true };
}

// 2026-08-05: id used to be [origin, dest, departDate, cabin] only, 
// watch-check.mjs's actual SerpApi request also varies on returnDate
// (one-way vs. round-trip, a real search difference) and travelers (the
// adults= param), so two watches that only differed in one of those were
// silently treated as "already watching" and the second request's
// returnDate/travelers were dropped on the floor. Both are now part of the
// id. Pre-existing stored trips keep whatever id they were created with
// (id is stored per-trip, never recomputed), the only transition cost is
// that a trip watched before this fix won't dedupe against a same-route
// request made after it; it'll just be judged as a new watch (subject to
// the normal MAX_TRIPS cap) rather than silently dropping the new
// returnDate/travelers, which is the correct direction to fail in.
export function buildWatchId(t) {
  const returnDate = /^\d{4}-\d{2}-\d{2}$/.test(t.returnDate || "") ? t.returnDate : null;
  const travelers = Math.min(9, Math.max(1, parseInt(t.travelers, 10) || 1));
  return [t.originIata, t.destIata, t.departDate, t.cabin || "Economy", returnDate || "-", travelers].join("|");
}

function normalizeTrip(t, id) {
  const returnDate = /^\d{4}-\d{2}-\d{2}$/.test(t.returnDate || "") ? t.returnDate : null;
  const travelers = Math.min(9, Math.max(1, parseInt(t.travelers, 10) || 1));
  return {
    id,
    originIata: t.originIata, destIata: t.destIata,
    origin: String(t.origin || t.originIata).slice(0, 60), destination: String(t.destination || t.destIata).slice(0, 60),
    departDate: t.departDate, returnDate,
    cabin: ["Economy", "Premium Economy", "Business", "First", "Best Value"].includes(t.cabin) ? t.cabin : "Economy",
    travelers,
    createdAt: new Date().toISOString(),
    baseline: t.baseline && typeof t.baseline.price === "number" ? { price: Math.round(t.baseline.price), carrier: String(t.baseline.carrier || "").slice(0, 60), at: new Date().toISOString() } : null,
    checks: [], // appended by watch-check.mjs, newest last, capped at 30
  };
}

// Pure decision function for a POST: given the CURRENT trips list (as read
// at some point in time) and the incoming request, decide what should
// happen, never touches storage itself, so it's fully unit-testable and
// the handler's optimistic-concurrency retry loop (below) just calls this
// fresh against whatever the latest read was.
export function planAddTrip(trips, t) {
  const valid = validateTripInput(t);
  if (valid.error) return { action: "error", error: valid.error, status: 400 };
  const id = buildWatchId(t);
  if (trips.some((x) => x.id === id)) return { action: "duplicate", trips };
  if (trips.length >= MAX_TRIPS) {
    return { action: "error", error: `Watch cap is ${MAX_TRIPS} trips (each costs one live search per day, quota discipline). Stop watching one first.`, status: 409 };
  }
  return { action: "add", trips: trips.concat([normalizeTrip(t, id)]) };
}

// Same idea for DELETE.
export function planRemoveTrip(trips, id) {
  const next = trips.filter((x) => x.id !== id);
  if (next.length === trips.length) return { action: "noop", trips: next };
  return { action: "remove", trips: next };
}

export default async (req) => {
  const url = new URL(req.url);
  const method = req.method;

  // Auth gate runs BEFORE getStore() -- same order wishlist.mjs/records.mjs
  // use. Checked here, ahead of any Blobs call, so an unauthorized or
  // misconfigured request always gets a clean 401 rather than depending on
  // getStore() not throwing first. GET is intentionally excluded, browsing
  // watched trips and running the optimizer were never the risk this gate
  // exists for.
  if ((method === "POST" || method === "DELETE") && !checkWriteAuth(req)) {
    return json({ error: "unauthorized: wrong or missing edit key" }, 401);
  }

  // strong consistency: a GET right after a watch/unwatch must reflect it
  // (default eventual consistency made the card vanish on quick reloads)
  const store = getStore({ name: "watched-trips", consistency: "strong" });

  if (method === "GET") {
    const trips = (await store.get("list", { type: "json" })) || [];
    const health = (await store.get("health", { type: "json" })) || null;
    return json({ trips, max: MAX_TRIPS, health });
  }

  if (method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "Invalid JSON body" }, 400); }
    const t = body && body.trip;
    const valid = validateTripInput(t);
    if (valid.error) return json({ error: valid.error }, 400);
    // 2026-08-05: optimistic-concurrency guard around the cap check, the
    // old code read the list, checked .length, then wrote, with no
    // protection against two near-simultaneous POSTs (e.g. a double-click,
    // or two open tabs) both reading the same under-cap list and both
    // writing, pushing the count past MAX_TRIPS and breaking the quota
    // math watch-check.mjs depends on. getWithMetadata/onlyIfMatch (both
    // already part of @netlify/blobs, no new dependency) makes the write
    // conditional on nothing else having changed the list since this read;
    // a lost race just retries against the fresh list, bounded so a
    // pathological case can't loop forever. planAddTrip is the pure
    // decision function (see above), this loop is just I/O around it.
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await store.getWithMetadata("list", { type: "json" });
      const trips = (current && current.data) || [];
      const etag = current && current.etag;
      const plan = planAddTrip(trips, t);
      if (plan.action === "error") return json({ error: plan.error }, plan.status);
      if (plan.action === "duplicate") return json({ ok: true, trips: plan.trips, note: "already watching" });
      const result = etag
        ? await store.setJSON("list", plan.trips, { onlyIfMatch: etag })
        : await store.setJSON("list", plan.trips, { onlyIfNew: true });
      if (result.modified) return json({ ok: true, trips: plan.trips });
      // someone else wrote in between (or created the key first), loop and retry against the fresh list
    }
    return json({ error: "Could not save the watch right now. Please try again." }, 409);
  }

  if (method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    // same optimistic-concurrency pattern as POST, for the same reason, 
    // an unwatch racing another write shouldn't be able to silently lose.
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await store.getWithMetadata("list", { type: "json" });
      const trips = (current && current.data) || [];
      const etag = current && current.etag;
      const plan = planRemoveTrip(trips, id);
      if (plan.action === "noop") return json({ ok: true, trips: plan.trips }); // nothing to remove, no write needed
      const result = etag
        ? await store.setJSON("list", plan.trips, { onlyIfMatch: etag })
        : await store.setJSON("list", plan.trips, { onlyIfNew: true });
      if (result.modified) return json({ ok: true, trips: plan.trips });
    }
    return json({ error: "Could not update watched trips right now. Please try again." }, 409);
  }

  return json({ error: "Method not allowed" }, 405);
};
