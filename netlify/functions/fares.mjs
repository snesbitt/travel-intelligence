// netlify/functions/fares.mjs
// version: 3 (2026-07-30)
// Live fare search backend — the piece that takes Travel Intelligence out
// of demo mode.
//
// v1 targeted the Amadeus Self-Service API; Amadeus decommissioned that
// portal on 2026-07-17 (verified on their site the following day — new
// self-service signups no longer exist, enterprise-sales only). v2 swaps
// the provider to SerpApi's Google Flights engine: real Google Flights
// results, self-serve API key, free tier of 100 searches/month — ample
// for personal trip planning. The credential lives ONLY in the Netlify
// env var SERPAPI_KEY, never in source, per CLAUDE.md. With no credential
// configured this returns {live:false, reason:"not_configured"} and the
// frontend states plainly that it's running the documented model instead
// — honest fallback, never a silent one.
//
// v3 (2026-07-30): adds a multi-city path for via/stopover trips ("SFO ->
// Bangkok via Osaka"). Previously the frontend hard-blocked any via search
// rather than reintroduce the synthetic-model path that was deliberately
// deleted (see CLAUDE.md's radical-simplicity note) — but SerpApi's Google
// Flights engine already supports real multi-city itineraries natively
// (type=3, multi_city_json), so via-routing can stay on the SAME "live
// feed or honest no-data" principle: no modeling, just a real search with
// more than one leg. A `legs` query param (JSON array of {origin,
// destination, date}, 2-4 legs) switches the handler onto this path;
// everything else — caching, offer mapping, response shape — is shared
// with the single-route path so the two can't drift apart.

// Quota guard (added 2026-07-20): identical searches (same origin/dest/
// dates/adults/cabin, or same legs/adults/cabin for a multi-city search)
// within a 15-minute window are served from a @netlify/blobs cache instead
// of re-hitting SerpApi. This protects the 100/month quota from repeat
// page loads or re-comparing cabin classes in one sitting, without ever
// staling a genuinely new search.

// @netlify/blobs is imported dynamically inside the handler, not at module
// top-level, so this file's pure, dependency-free exports (buildFareCacheKey,
// isCacheFresh, CACHE_TTL_MS, parseLegs, buildLegsCacheKey) can be imported
// and unit-tested without needing @netlify/blobs installed/resolvable —
// Netlify's own runtime always has it available when the handler actually
// runs, so this changes nothing about production behavior.

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const CABIN_CLASS = { Economy: "1", "Premium Economy": "2", Business: "3", First: "4" };
const IATA_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_LEGS = 2;
const MAX_LEGS = 4; // origin->via(s)->destination[->origin]; guards against a malformed/huge request

export const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min - protects quota, short enough fares never feel stale

// Pure, no I/O — exported so the quota-cache logic is directly unit-testable
// without mocking fetch/@netlify/blobs (same pattern as audio-preview.mjs's
// named exports in the vinyl-scout repo). Stable/deterministic: same search
// params always produce the same key, order matters (that's fine, callers
// always build it from the same fixed field order below).
export function buildFareCacheKey(origin, destination, departDate, returnDate, adults, cabin) {
  return "farecache-" + ["v1", origin, destination, departDate, returnDate, adults, cabin].join("|");
}

// Pure — given a cache entry's stored timestamp and "now", is it still
// within the TTL window? Exported for the same reason as buildFareCacheKey.
export function isCacheFresh(cachedAt, now, ttlMs) {
  return typeof cachedAt === "number" && (now - cachedAt) < ttlMs;
}

// Pure — validates and normalizes a `legs` query param into a { origin,
// destination, date } array, or null on anything malformed. Kept strict:
// a bad via-routing request should fail loudly (400, see the handler)
// rather than silently degrade into a wrong search.
//
// @param {string} raw - the raw (not yet JSON.parse'd) `legs` query value
// @returns {Array<{origin: string, destination: string, date: string}> | null}
export function parseLegs(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let legs;
  try {
    legs = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(legs) || legs.length < MIN_LEGS || legs.length > MAX_LEGS) return null;

  const normalized = [];
  for (const leg of legs) {
    if (!leg || typeof leg !== "object") return null;
    const origin = String(leg.origin || "").toUpperCase();
    const destination = String(leg.destination || "").toUpperCase();
    const date = String(leg.date || "");
    if (!IATA_RE.test(origin) || !IATA_RE.test(destination) || !DATE_RE.test(date)) return null;
    if (origin === destination) return null; // a zero-distance leg isn't a real leg
    normalized.push({ origin, destination, date });
  }

  // Each leg must depart on or after the previous leg's date — a multi-city
  // itinerary that goes backward in time isn't bookable and SerpApi will
  // just error on it less clearly than we can here.
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].date < normalized[i - 1].date) return null;
  }

  return normalized;
}

// Pure — same role as buildFareCacheKey, for the multi-city path. Legs are
// already normalized (parseLegs) by the time this is called.
export function buildLegsCacheKey(legs, adults, cabin) {
  const legPart = legs.map((l) => `${l.origin}-${l.destination}-${l.date}`).join(">");
  return "farecache-" + ["v1-multicity", legPart, adults, cabin].join("|");
}

function titleCaseCarrier(list) {
  // an itinerary can mix carriers across segments; report the distinct set
  const names = Array.from(new Set(list.filter(Boolean)));
  return names.join(" + ") || "Unknown carrier";
}

function s0code(seg) {
  const fn = seg.flight_number || "";
  const m = /^([A-Z0-9]{2})\s/.exec(fn);
  return m ? m[1] : "";
}

// Google Flights normally returns price as a number, but has been
// observed to send a currency-prefixed string (e.g. "$1,234") for some
// itineraries. parseFloat("$1,234") is NaN, which silently dropped the
// offer below with no signal that anything was lost. Strip everything
// but digits and a decimal point before parsing so those offers survive.
function parsePrice(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Shared by both the single-route and multi-city paths: SerpApi's Google
// Flights response shape (best_flights/other_flights, each an itinerary
// with a `flights` segment array covering every leg requested) is
// identical either way — for a multi-city search, `flights` already
// covers all legs concatenated and `price` is the whole itinerary's
// total. Factored out so the two paths can't map offers differently.
function mapOffers(j) {
  const raw = [...(j.best_flights || []), ...(j.other_flights || [])];
  const mapped = raw.slice(0, 20).map((o, idx) => {
    const segs = o.flights || [];
    return {
      id: idx,
      carrier: titleCaseCarrier(segs.map((s) => s.airline)),
      carrierCode: (segs[0] && s0code(segs[0])) || "",
      priceTotal: parsePrice(o.price), // TOTAL for all travelers, USD
      stops: Math.max(0, segs.length - 1),
      durationMinutes: o.total_duration || null, // whole itinerary as returned by Google Flights
      cabins: [],
      bookableSeats: null,
      aircraft: segs[0] && segs[0].airplane ? segs[0].airplane : null,
      isBest: idx < (j.best_flights || []).length,
    };
  });
  const offers = mapped.filter((o) => o.priceTotal);
  const droppedForUnparseablePrice = mapped.length - offers.length; // visible, not silent
  if (droppedForUnparseablePrice > 0) {
    console.warn(`fares.mjs: dropped ${droppedForUnparseablePrice} offer(s) with an unparseable price`);
  }
  return { offers, droppedForUnparseablePrice };
}

function priceInsightsFrom(j) {
  return j.price_insights ? {
    lowestPrice: parsePrice(j.price_insights.lowest_price),
    priceLevel: j.price_insights.price_level || null,
    typicalRange: Array.isArray(j.price_insights.typical_price_range) ? j.price_insights.typical_price_range.map(parsePrice) : null,
    history: Array.isArray(j.price_insights.price_history) ? j.price_insights.price_history.slice(-60) : null,
  } : null;
}

export const config = { path: "/api/fares" };

export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.SERPAPI_KEY;

  if (url.searchParams.get("ping")) {
    return json({ live: Boolean(key), reason: key ? "ready" : "not_configured", provider: "serpapi-google-flights" });
  }

  const adults = Math.min(9, Math.max(1, parseInt(url.searchParams.get("adults") || "1", 10)));
  const cabin = url.searchParams.get("cabin") || "";
  const legsRaw = url.searchParams.get("legs");

  // ---------- multi-city (via/stopover) path ----------
  if (legsRaw) {
    const legs = parseLegs(legsRaw);
    if (!legs) {
      return json({ live: false, reason: "bad_request", detail: "legs must be a JSON array of 2-4 {origin, destination, date} objects, each with IATA codes, YYYY-MM-DD dates, and non-decreasing dates" }, 400);
    }
    if (!key) return json({ live: false, reason: "not_configured" }, 503);

    const cacheKey = buildLegsCacheKey(legs, adults, cabin);
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "watched-trips", consistency: "strong" });

    try {
      const hit = await store.get(cacheKey, { type: "json" });
      if (hit && isCacheFresh(hit.cachedAt, Date.now(), CACHE_TTL_MS)) {
        return json({ ...hit.payload, cached: true }, 200);
      }
    } catch (e) {
      console.warn("fares.mjs: cache read failed", e && e.message);
    }

    const q = new URLSearchParams({
      engine: "google_flights",
      type: "3", // multi-city
      multi_city_json: JSON.stringify(legs.map((l) => ({ departure_id: l.origin, arrival_id: l.destination, date: l.date }))),
      adults: String(adults),
      currency: "USD",
      hl: "en",
      api_key: key,
    });
    if (CABIN_CLASS[cabin]) q.set("travel_class", CABIN_CLASS[cabin]);

    let res;
    try {
      res = await fetch("https://serpapi.com/search?" + q);
    } catch (e) {
      return json({ live: false, reason: "upstream_unreachable" }, 502);
    }
    if (!res.ok) {
      const detail = await res.text();
      return json({ live: false, reason: "upstream_error", status: res.status, detail: detail.slice(0, 400) }, 502);
    }
    const j = await res.json();
    if (j.error) return json({ live: false, reason: "upstream_error", detail: String(j.error).slice(0, 400) }, 502);

    const { offers, droppedForUnparseablePrice } = mapOffers(j);
    const payload = {
      live: true,
      retrievedAt: new Date().toISOString(),
      provider: "Google Flights (SerpApi, multi-city)",
      legs,
      origin: legs[0].origin,
      destination: legs[legs.length - 1].destination,
      departDate: legs[0].date,
      returnDate: legs.length > 2 ? legs[legs.length - 1].date : null,
      adults,
      offers,
      droppedForUnparseablePrice,
      priceInsights: priceInsightsFrom(j),
    };

    try {
      await store.setJSON(cacheKey, { cachedAt: Date.now(), payload });
    } catch (e) {
      console.warn("fares.mjs: cache write failed", e && e.message);
    }

    return json({ ...payload, cached: false });
  }

  // ---------- single-route path (unchanged from v2) ----------
  const origin = (url.searchParams.get("origin") || "").toUpperCase();
  const destination = (url.searchParams.get("destination") || "").toUpperCase();
  const departDate = url.searchParams.get("depart") || "";
  const returnDate = url.searchParams.get("return") || "";

  if (!IATA_RE.test(origin) || !IATA_RE.test(destination) || !DATE_RE.test(departDate)) {
    return json({ live: false, reason: "bad_request", detail: "origin/destination must be IATA codes, depart must be YYYY-MM-DD" }, 400);
  }
  if (!key) return json({ live: false, reason: "not_configured" }, 503);

  // Reuses the existing "watched-trips" blob store (key-prefixed "farecache-")
  // rather than a second store, per the radical-simplicity rule in CLAUDE.md.
  const cacheKey = buildFareCacheKey(origin, destination, departDate, returnDate, adults, cabin);
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "watched-trips", consistency: "strong" });

  try {
    const hit = await store.get(cacheKey, { type: "json" });
    if (hit && isCacheFresh(hit.cachedAt, Date.now(), CACHE_TTL_MS)) {
      return json({ ...hit.payload, cached: true }, 200);
    }
  } catch (e) {
    console.warn("fares.mjs: cache read failed", e && e.message);
  }

  const q = new URLSearchParams({
    engine: "google_flights",
    departure_id: origin,
    arrival_id: destination,
    outbound_date: departDate,
    adults: String(adults),
    currency: "USD",
    hl: "en",
    api_key: key,
  });
  if (DATE_RE.test(returnDate)) { q.set("return_date", returnDate); q.set("type", "1"); }
  else { q.set("type", "2"); }
  if (CABIN_CLASS[cabin]) q.set("travel_class", CABIN_CLASS[cabin]);

  let res;
  try {
    res = await fetch("https://serpapi.com/search?" + q);
  } catch (e) {
    return json({ live: false, reason: "upstream_unreachable" }, 502);
  }
  if (!res.ok) {
    const detail = await res.text();
    return json({ live: false, reason: "upstream_error", status: res.status, detail: detail.slice(0, 400) }, 502);
  }
  const j = await res.json();
  if (j.error) return json({ live: false, reason: "upstream_error", detail: String(j.error).slice(0, 400) }, 502);

  const { offers, droppedForUnparseablePrice } = mapOffers(j);
  const payload = {
    live: true,
    retrievedAt: new Date().toISOString(),
    provider: "Google Flights (SerpApi)",
    origin, destination, departDate, returnDate: returnDate || null, adults,
    offers,
    droppedForUnparseablePrice,
    // 2026-07-25: Google Flights' own price intelligence, previously
    // discarded. Costs zero extra quota — it rides along on the same
    // search response. null when Google has no insight for the route.
    priceInsights: priceInsightsFrom(j),
  };

  try {
    await store.setJSON(cacheKey, { cachedAt: Date.now(), payload });
  } catch (e) {
    console.warn("fares.mjs: cache write failed", e && e.message);
  }

  return json({ ...payload, cached: false });
};
