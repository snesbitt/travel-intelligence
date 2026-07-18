// netlify/functions/fares.mjs
// version: 2 (2026-07-18)
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

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const CABIN_CLASS = { Economy: "1", "Premium Economy": "2", Business: "3", First: "4" };

function titleCaseCarrier(list) {
  // an itinerary can mix carriers across segments; report the distinct set
  const names = Array.from(new Set(list.filter(Boolean)));
  return names.join(" + ") || "Unknown carrier";
}

export const config = { path: "/api/fares" };

export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.SERPAPI_KEY;

  if (url.searchParams.get("ping")) {
    return json({ live: Boolean(key), reason: key ? "ready" : "not_configured", provider: "serpapi-google-flights" });
  }

  const origin = (url.searchParams.get("origin") || "").toUpperCase();
  const destination = (url.searchParams.get("destination") || "").toUpperCase();
  const departDate = url.searchParams.get("depart") || "";
  const returnDate = url.searchParams.get("return") || "";
  const adults = Math.min(9, Math.max(1, parseInt(url.searchParams.get("adults") || "1", 10)));
  const cabin = url.searchParams.get("cabin") || "";

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(departDate)) {
    return json({ live: false, reason: "bad_request", detail: "origin/destination must be IATA codes, depart must be YYYY-MM-DD" }, 400);
  }
  if (!key) return json({ live: false, reason: "not_configured" }, 503);

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) { q.set("return_date", returnDate); q.set("type", "1"); }
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

  const raw = [...(j.best_flights || []), ...(j.other_flights || [])];
  const offers = raw.slice(0, 20).map((o, idx) => {
    const segs = o.flights || [];
    return {
      id: idx,
      carrier: titleCaseCarrier(segs.map((s) => s.airline)),
      carrierCode: (segs[0] && s0code(segs[0])) || "",
      priceTotal: typeof o.price === "number" ? o.price : parseFloat(o.price) || null, // TOTAL for all travelers, USD
      stops: Math.max(0, segs.length - 1),
      durationMinutes: o.total_duration || null, // whole itinerary as returned by Google Flights
      cabins: [],
      bookableSeats: null,
      aircraft: segs[0] && segs[0].airplane ? segs[0].airplane : null,
      isBest: idx < (j.best_flights || []).length,
    };
  }).filter((o) => o.priceTotal);

  function s0code(seg) {
    const fn = seg.flight_number || "";
    const m = /^([A-Z0-9]{2})\s/.exec(fn);
    return m ? m[1] : "";
  }

  return json({
    live: true,
    retrievedAt: new Date().toISOString(),
    provider: "Google Flights (SerpApi)",
    origin, destination, departDate, returnDate: returnDate || null, adults,
    offers,
  });
};
