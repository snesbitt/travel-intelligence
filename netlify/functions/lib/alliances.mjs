// netlify/functions/lib/alliances.mjs
// 2026-11-22: server-side Star Alliance membership, for watched trips that
// must stay inside one alliance (so Miles and More credit works on every
// flight, whatever carrier is cheapest on the day). Kept apart from
// app.js's ALLIANCES table on purpose: that table is a short carrier list
// for scoring and does not include Ethiopian, South African or SWISS, which
// are Star members. This list is the one the watch checker trusts.
// Hand-maintained and dated: re-check against staralliance.com when the
// membership changes (SAS left in 2024). Names are lower-case forms as
// Google Flights (via SerpApi) prints them. A name not listed counts as NOT
// Star, so an unknown airline can only make a watch skip a fare, never
// record a wrong one.
export const STAR_ALLIANCE_AS_OF = "2026-11-22";
const STAR_NAMES = new Set([
  "aegean", "aegean airlines", "air canada", "air china", "air india", "air new zealand",
  "ana", "all nippon airways", "asiana", "asiana airlines", "austrian", "austrian airlines",
  "avianca", "brussels airlines", "copa", "copa airlines", "croatia airlines", "egyptair",
  "ethiopian", "ethiopian airlines", "eva air", "lot", "lot polish airlines", "lufthansa",
  "shenzhen airlines", "singapore airlines", "south african", "south african airways",
  "swiss", "swiss international air lines", "tap air portugal", "tap portugal", "thai",
  "thai airways", "turkish", "turkish airlines", "united", "united airlines",
]);

// Exported so a test can prove app.js's browser copy has not drifted.
export const STAR_AIRLINE_NAMES = [...STAR_NAMES];

export function isStarAirline(name) {
  return STAR_NAMES.has(String(name || "").trim().toLowerCase());
}

// An offer qualifies only when EVERY flight segment it shows is a Star
// airline. An empty or missing segment list never qualifies.
export function isStarOffer(offer) {
  const segs = (offer && offer.flights) || [];
  return segs.length > 0 && segs.every((s) => isStarAirline(s && s.airline));
}

// "United + Ethiopian" style label from the distinct airlines, in order.
export function carrierLabel(offer) {
  const seen = [];
  for (const s of (offer && offer.flights) || []) {
    if (s && s.airline && !seen.includes(s.airline)) seen.push(s.airline);
  }
  return seen.join(" + ");
}
