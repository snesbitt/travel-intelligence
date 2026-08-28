// netlify/functions/scan-offers.mjs
// version: 1 (2026-07-25)
// Storage for browser-scanned OTA offers (Kayak, Booking.com), the
// "deep scan" feed. Scans are collected in Susan's own logged-in Chrome
// during a Cowork session (server-side scraping of these sites 403s and
// violates their ToS; her browser doing her own personal searches does
// not, the exact pattern Vinyl Scout uses for Discogs medians), then
// POSTed here so the optimizer can merge them with the live SerpApi
// feed. Same open POST model and Blobs store as watch.mjs (no auth,
// nothing sensitive: routes, dates, carrier names, prices). Reuses the
// watched-trips store under a "scanoffers-" key prefix, same
// single-store discipline as the fares.mjs cache ("farecache-").
// Freshness is the reader's job: the frontend ignores scans older than
// SCAN_TTL_H (exported for tests, 24h) rather than this file deleting
// anything.
//
// 2026-08-28: POST is now gated by the same X-Edit-Key / EDIT_SECRET
// pattern watch.mjs (v4, 2026-08-08) uses -- checkWriteAuth() below is
// the identical check, copied rather than imported (this repo keeps
// cross-function sharing in netlify/functions/lib/, and a 4-line auth
// check didn't earn a new lib file). Closes the same gap watch.mjs v4
// closed there: this store was described above as "no auth, nothing
// sensitive," but it's still a write anyone with the site URL could
// spam or pollute (fake offers feeding the optimizer's merge), and
// scan-offers.mjs was the one write endpoint watch.mjs's v4 pass never
// touched. GET stays public, same reasoning as watch.mjs: reading scans
// was never the risk.

export const SCAN_TTL_H = 24;
const MAX_OFFERS = 12;
const SOURCES = ["Kayak", "Booking.com"];
const ROUTE_RE = /^[A-Z]{3}-[A-Z]{3}-\d{4}-\d{2}-\d{2}(-\d{4}-\d{2}-\d{2})?$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Same as watch.mjs's checkWriteAuth: fails closed if EDIT_SECRET is
// unset, a misconfigured deploy rejects writes rather than silently
// accepting them from anyone.
export function checkWriteAuth(req) {
  const expected = process.env.EDIT_SECRET;
  const provided = req.headers.get("x-edit-key");
  return !!(expected && provided && provided === expected);
}

// Pure validator, exported for tests: returns a sanitized record or null.
export function sanitizeScan(body) {
  if (!body || typeof body !== "object") return null;
  const routeKey = String(body.routeKey || "");
  if (!ROUTE_RE.test(routeKey)) return null;
  if (!SOURCES.includes(body.source)) return null;
  if (!Array.isArray(body.offers) || !body.offers.length) return null;
  const offers = body.offers.slice(0, MAX_OFFERS).map((o) => ({
    carrier: String(o.carrier || "").slice(0, 60),
    priceTotal: typeof o.priceTotal === "number" && isFinite(o.priceTotal) && o.priceTotal > 0 ? Math.round(o.priceTotal) : null,
    stops: Number.isInteger(o.stops) && o.stops >= 0 && o.stops <= 4 ? o.stops : null,
    durationMinutes: typeof o.durationMinutes === "number" && isFinite(o.durationMinutes) && o.durationMinutes > 0 ? Math.round(o.durationMinutes) : null,
  })).filter((o) => o.carrier && o.priceTotal);
  if (!offers.length) return null;
  return { routeKey, source: body.source, offers, scannedAt: new Date().toISOString() };
}

export default async (req) => {
  // Auth gate runs before getStore(), same order/reasoning as watch.mjs:
  // an unauthorized or misconfigured request gets a clean 401 rather than
  // depending on getStore() not throwing first. GET is excluded.
  if (req.method === "POST" && !checkWriteAuth(req)) {
    return json({ error: "unauthorized: wrong or missing edit key" }, 401);
  }

  // dynamic import keeps the pure exports above testable without blobs
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "watched-trips", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const key = String(url.searchParams.get("key") || "");
    if (!ROUTE_RE.test(key)) return json({ error: "key must look like SFO-GBE-2026-09-12[-2026-09-24]" }, 400);
    const scans = [];
    for (const source of SOURCES) {
      try {
        const rec = await store.get(`scanoffers-${key}-${source}`, { type: "json" });
        if (rec) scans.push(rec);
      } catch (e) { /* absent is fine */ }
    }
    return json({ key, scans });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    const rec = sanitizeScan(body);
    if (!rec) return json({ error: "scan rejected: routeKey (AAA-BBB-YYYY-MM-DD[-YYYY-MM-DD]), source (Kayak | Booking.com) and 1-12 offers with carrier + positive priceTotal required" }, 400);
    await store.setJSON(`scanoffers-${rec.routeKey}-${rec.source}`, rec);
    return json({ ok: true, stored: rec.offers.length, source: rec.source, scannedAt: rec.scannedAt });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/scan-offers" };
