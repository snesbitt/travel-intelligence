// netlify/functions/fares.mjs
// version: 1 (2026-07-18)
// Live fare search via the Amadeus Self-Service Flight Offers API — the
// backend that takes Travel Intelligence out of demo mode. The credential
// lives ONLY in Netlify env vars (AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET),
// never in source, per CLAUDE.md. With no credential configured this
// returns {live:false, reason:"not_configured"} and the frontend states
// plainly that it's running the documented model instead — honest fallback,
// never a silent one. Set AMADEUS_ENV=production to leave the free test
// environment once Susan approves any paid usage (spend rule in CLAUDE.md).

const HOSTS = { test: "https://test.api.amadeus.com", production: "https://api.amadeus.com" };

let cachedToken = null; // { token, expiresAt } — per warm lambda instance

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function host() {
  return HOSTS[(process.env.AMADEUS_ENV || "test").toLowerCase()] || HOSTS.test;
}

async function getToken() {
  const id = process.env.AMADEUS_CLIENT_ID, secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.token;
  const res = await fetch(host() + "/v1/security/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  cachedToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 1799) * 1000 };
  return cachedToken.token;
}

function isoDurationToMinutes(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso || "");
  return m ? (parseInt(m[1] || 0, 10) * 60 + parseInt(m[2] || 0, 10)) : null;
}

function titleCase(s) {
  return (s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export const config = { path: "/api/fares" };

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("ping")) {
    const configured = Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
    return json({ live: configured, reason: configured ? "ready" : "not_configured", env: (process.env.AMADEUS_ENV || "test") });
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

  const token = await getToken();
  if (!token) return json({ live: false, reason: "not_configured" }, 503);

  const cabinMap = { Economy: "ECONOMY", "Premium Economy": "PREMIUM_ECONOMY", Business: "BUSINESS", First: "FIRST" };
  const q = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: departDate,
    adults: String(adults),
    currencyCode: "USD",
    max: "20",
  });
  if (/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) q.set("returnDate", returnDate);
  if (cabinMap[cabin]) q.set("travelClass", cabinMap[cabin]);

  let res;
  try {
    res = await fetch(host() + "/v2/shopping/flight-offers?" + q, { headers: { Authorization: "Bearer " + token } });
  } catch (e) {
    return json({ live: false, reason: "upstream_unreachable" }, 502);
  }
  if (!res.ok) {
    const detail = await res.text();
    return json({ live: false, reason: "upstream_error", status: res.status, detail: detail.slice(0, 400) }, 502);
  }
  const j = await res.json();
  const carriers = (j.dictionaries && j.dictionaries.carriers) || {};

  const offers = (j.data || []).map((o, idx) => {
    const its = o.itineraries || [];
    const stopsPerLeg = its.map((it) => (it.segments || []).length - 1);
    const minutes = its.reduce((s, it) => s + (isoDurationToMinutes(it.duration) || 0), 0);
    const code = (o.validatingAirlineCodes && o.validatingAirlineCodes[0]) || (its[0] && its[0].segments[0] && its[0].segments[0].carrierCode) || "";
    const cabins = new Set();
    (o.travelerPricings || []).forEach((tp) => (tp.fareDetailsBySegment || []).forEach((fd) => fd.cabin && cabins.add(fd.cabin)));
    return {
      id: idx,
      carrierCode: code,
      carrier: titleCase(carriers[code] || code),
      priceTotal: parseFloat(o.price && o.price.grandTotal) || null, // total for ALL travelers, USD
      stops: Math.max(...(stopsPerLeg.length ? stopsPerLeg : [0])),
      durationMinutes: minutes || null, // out + return combined
      cabins: Array.from(cabins),
      bookableSeats: o.numberOfBookableSeats || null,
      lastTicketingDate: o.lastTicketingDate || null,
    };
  }).filter((o) => o.priceTotal);

  return json({
    live: true,
    retrievedAt: new Date().toISOString(),
    environment: (process.env.AMADEUS_ENV || "test"),
    origin, destination, departDate, returnDate: returnDate || null, adults,
    offers,
  });
};
