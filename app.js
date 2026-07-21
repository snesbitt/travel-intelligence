/* Travel Intelligence — optimization engine
 * Pure, deterministic, client-side. Fares arrive live from /api/fares
 * (Google Flights via SerpApi) and are scored by buildLiveCandidates;
 * when the backend is unreachable the engine falls back to a documented
 * model on hand-maintained, distance-scaled reference ranges — and the
 * UI states which mode produced the numbers. Mileage/award figures are
 * planning ranges in BOTH modes (award space isn't searched yet). See
 * guide.html steps 02–04.
 */

/* ---------- reference data (hand-maintained, not live-fetched) ---------- */

const ALLIANCES = {
  "Star Alliance": ["United", "Air Canada", "Lufthansa", "Singapore Airlines", "ANA", "Turkish Airlines"],
  "Oneworld": ["American", "Japan Airlines", "British Airways", "Qatar Airways", "Cathay Pacific", "Qantas"],
  "SkyTeam": ["Delta", "Air France", "KLM", "Korean Air"],
  "Unaligned": ["Alaska Airlines", "Emirates", "JetBlue"],
};

// Network accuracy (Susan, 2026-07-19): these carriers don't operate their
// own metal across the Pacific (American's Asia service is Tokyo-only —
// its Asia itineraries fly on oneworld partners like JAL and Cathay). On
// Asia-bound MODELED routes they're excluded from the candidate pool so
// the partner that actually operates the flight is what's displayed. Live
// results already name operating carriers, so this applies to the model
// only.
const NO_OWN_ASIA_SERVICE = ["American", "Alaska Airlines", "JetBlue"];

const ALL_CARRIERS = Object.values(ALLIANCES).flat();

// General reputation for complimentary/mileage upgrade generosity, 0-100.
// This is a hand-maintained editorial judgment, not a live seat-map read —
// see about.html for how this differs from a real inventory check.
const UPGRADE_FRIENDLY = {
  United: 78, "Air Canada": 63, Lufthansa: 52, "Singapore Airlines": 38, ANA: 44, "Turkish Airlines": 58,
  American: 74, "Japan Airlines": 42, "British Airways": 48, "Qatar Airways": 33, "Cathay Pacific": 43, Qantas: 54,
  Delta: 81, "Air France": 46, KLM: 49, "Korean Air": 41,
  "Alaska Airlines": 71, Emirates: 28, JetBlue: 62,
};

// Typical ROUND-TRIP miles + taxes/fees ranges by cabin (roughly double
// the commonly-cited one-way figures). Wide ranges on purpose — real
// pricing depends on route and release, which this engine doesn't fetch.
// Used only to judge whether a redemption is *plausible*, framed to the
// user as a planning range, never a quote.
const AWARD_RANGES = {
  Economy: { milesLow: 25000, milesHigh: 120000, feesLow: 11, feesHigh: 240 },
  "Premium Economy": { milesLow: 50000, milesHigh: 170000, feesLow: 40, feesHigh: 360 },
  Business: { milesLow: 115000, milesHigh: 320000, feesLow: 80, feesHigh: 800 },
  First: { milesLow: 160000, milesHigh: 480000, feesLow: 120, feesHigh: 1000 },
  "Best Value": { milesLow: 50000, milesHigh: 200000, feesLow: 40, feesHigh: 500 },
};

// Round-trip cash price model inputs — approximate mid-market planning
// figures, not a fetched fare. See the eyebrow banner on index.html.
const CABIN_BASE = { Economy: 620, "Premium Economy": 1250, Business: 3600, First: 8200, "Best Value": 850 };
const CABIN_STOP_DISCOUNT = { Economy: 26, "Premium Economy": 45, Business: 90, First: 160, "Best Value": 40 };
const CABIN_FLOOR = { Economy: 220, "Premium Economy": 560, Business: 1800, First: 4200, "Best Value": 320 };
const CABIN_COMFORT_BASE = { Economy: 38, "Premium Economy": 58, Business: 85, First: 97, "Best Value": 54 };

const TRANSFER_PARTNERS = {
  "American Express Membership Rewards": { ratio: "1:1", value: 2.0, note: "transfers to most Star Alliance and Oneworld programs, plus Delta, Flying Blue, Virgin Atlantic, ANA, Avianca LifeMiles" },
  "Chase Ultimate Rewards": { ratio: "1:1", value: 2.05, note: "transfers to United, Air Canada Aeroplan, Air France/KLM Flying Blue, Virgin Atlantic, Singapore, British Airways — no American or Delta" },
  "Capital One": { ratio: "1:1 (most partners)", value: 1.85, note: "transfers to Air Canada Aeroplan, Turkish, Avianca LifeMiles, Air France/KLM, Cathay, EVA" },
  "Citi ThankYou": { ratio: "1:1 (most partners)", value: 1.9, note: "transfers to Turkish, Air France/KLM, Avianca LifeMiles, Qatar Avios" },
  "Bilt Rewards": { ratio: "1:1", value: 2.2, note: "transfers to United, American, Air France/KLM, Turkish, Alaska — the only major card that transfers to American, and TPG's highest-valued currency" },
  "Wells Fargo": { ratio: "1:1", value: 1.75, note: "transfers to Air France/KLM, Avianca LifeMiles, Virgin Atlantic" },
  "Marriott Bonvoy": { ratio: "3:1 (plus a 5,000 bonus per 60k converted)", value: 0.8, note: "weak ratio for flights — hotel points converted to air are rarely a good redemption" },
};

// TPG's published monthly valuations, July 2026 issue (thepointsguy.com/
// loyalty-programs/monthly-valuations/). Hand-copied on 2026-07-18, not
// live-fetched — re-copy monthly or when a program devalues. Cents per
// point/mile. This is the "which airline's points are actually worth the
// most" answer, straight from the source Susan asked to pull in.
const POINT_VALUATIONS = {
  asOf: "July 2026 (TPG monthly valuations, copied 2026-07-18)",
  cards: {
    "Bilt Rewards": 2.2, "Chase Ultimate Rewards": 2.05, "American Express Membership Rewards": 2.0,
    "Citi ThankYou": 1.9, "Capital One": 1.85, "Wells Fargo": 1.75,
  },
  airlines: {
    "Alaska Atmos Rewards": 1.55, "Flying Blue (Air France/KLM)": 1.55, "Air Canada Aeroplan": 1.5,
    "Virgin Atlantic Flying Club": 1.5, "Avianca LifeMiles": 1.45, "American AAdvantage": 1.4,
    "ANA Mileage Club": 1.4, "Avios (BA/Iberia/Qatar)": 1.4, "JetBlue TrueBlue": 1.35,
    "United MileagePlus": 1.3, "Cathay Asia Miles": 1.3, "Qantas Frequent Flyer": 1.3,
    "Singapore KrisFlyer": 1.3, "Southwest Rapid Rewards": 1.25, "Delta SkyMiles": 1.2,
    "Emirates Skywards": 1.2, "Etihad Guest": 1.2, "Turkish Miles&Smiles": 1.1,
  },
};

// Active transfer bonuses — hand-copied 2026-07-18 from TPG's current-
// transfer-bonuses page; these expire and change monthly, so each entry
// carries its end date and the UI must always show it.
const TRANSFER_BONUSES = [
  { from: "American Express Membership Rewards", to: "Virgin Atlantic Flying Club", bonus: "30%", ends: "Jul 31, 2026" },
  { from: "Capital One", to: "EVA Air Infinity MileageLands", bonus: "30%", ends: "Jul 31, 2026" },
];

// Hand-maintained coordinates for common origin/destination cities and
// airport codes, used to compute a real great-circle distance per route.
// Flight time and the distance scaling of fares derive from THIS — not a
// schedule read, but geometry plus a cruise-speed model, so a nonstop to
// Europe reads ~11h, not a fabricated short-haul number. If a city isn't
// here, the engine says so in the insights and assumes a generic 7,500 km
// long-haul rather than silently pretending.
const CITY_COORDS = {
  "san francisco": [37.62, -122.38], sfo: [37.62, -122.38], sjc: [37.36, -121.93], oak: [37.72, -122.22],
  "los angeles": [33.94, -118.41], lax: [33.94, -118.41], "san diego": [32.73, -117.19], seattle: [47.45, -122.31],
  portland: [45.59, -122.60], denver: [39.86, -104.67], phoenix: [33.43, -112.01], "las vegas": [36.08, -115.15],
  dallas: [32.90, -97.04], austin: [30.19, -97.67], houston: [29.98, -95.34], chicago: [41.98, -87.90],
  minneapolis: [44.88, -93.22], detroit: [42.21, -83.35], atlanta: [33.64, -84.43], miami: [25.79, -80.29],
  orlando: [28.43, -81.31], tampa: [27.98, -82.53], charlotte: [35.21, -80.94], washington: [38.95, -77.46],
  "new york": [40.64, -73.78], nyc: [40.64, -73.78], jfk: [40.64, -73.78], ewr: [40.69, -74.17],
  boston: [42.36, -71.01], philadelphia: [39.87, -75.24], honolulu: [21.32, -157.92], anchorage: [61.17, -150.00],
  vancouver: [49.19, -123.18], toronto: [43.68, -79.63], montreal: [45.47, -73.74], "mexico city": [19.44, -99.07],
  cancun: [21.04, -86.87], london: [51.47, -0.45], lhr: [51.47, -0.45], paris: [49.01, 2.55], cdg: [49.01, 2.55],
  rome: [41.80, 12.24], fco: [41.80, 12.24], madrid: [40.47, -3.56], barcelona: [41.30, 2.08],
  lisbon: [38.77, -9.13], amsterdam: [52.31, 4.76], frankfurt: [50.03, 8.56], munich: [48.35, 11.79],
  zurich: [47.46, 8.55], geneva: [46.24, 6.11], vienna: [48.11, 16.57], prague: [50.10, 14.26],
  berlin: [52.36, 13.50], dublin: [53.43, -6.25], edinburgh: [55.95, -3.37], copenhagen: [55.62, 12.66],
  stockholm: [59.65, 17.92], oslo: [60.19, 11.10], helsinki: [60.32, 24.96], athens: [37.94, 23.94],
  istanbul: [41.26, 28.74], "tel aviv": [32.01, 34.89], dubai: [25.25, 55.36], doha: [25.27, 51.61],
  delhi: [28.56, 77.10], mumbai: [19.09, 72.87], singapore: [1.36, 103.99], bangkok: [13.69, 100.75],
  "hong kong": [22.31, 113.91], tokyo: [35.55, 139.78], hnd: [35.55, 139.78], nrt: [35.77, 140.39],
  osaka: [34.43, 135.23], seoul: [37.46, 126.44], icn: [37.46, 126.44], beijing: [40.08, 116.58],
  shanghai: [31.14, 121.81], taipei: [25.08, 121.23], manila: [14.51, 121.02], sydney: [-33.95, 151.18],
  melbourne: [-37.67, 144.84], auckland: [-37.01, 174.79], "buenos aires": [-34.82, -58.54],
  "sao paulo": [-23.43, -46.47], "rio de janeiro": [-22.81, -43.25], lima: [-12.02, -77.11],
  bogota: [4.70, -74.15], santiago: [-33.39, -70.79], johannesburg: [-26.14, 28.25], "cape town": [-33.96, 18.60],
  cairo: [30.12, 31.41], nairobi: [-1.32, 36.93], casablanca: [33.37, -7.59], reykjavik: [63.99, -22.61],
};

function lookupCoords(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (CITY_COORDS[n]) return CITY_COORDS[n];
  for (const key of Object.keys(CITY_COORDS)) {
    if (n.includes(key) || key.includes(n)) return CITY_COORDS[key];
  }
  return null;
}

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

function routeDistanceKm(origin, destination) {
  const a = lookupCoords(origin), b = lookupCoords(destination);
  if (!a || !b) return { km: null, known: false };
  return { km: haversineKm(a, b), known: true };
}

// City → primary IATA code, for the live fare search. Same coverage as
// CITY_COORDS; a raw 3-letter input is used as-is.
const CITY_IATA = {
  "san francisco": "SFO", "los angeles": "LAX", "san diego": "SAN", seattle: "SEA", portland: "PDX",
  denver: "DEN", phoenix: "PHX", "las vegas": "LAS", dallas: "DFW", austin: "AUS", houston: "IAH",
  chicago: "ORD", minneapolis: "MSP", detroit: "DTW", atlanta: "ATL", miami: "MIA", orlando: "MCO",
  tampa: "TPA", charlotte: "CLT", washington: "IAD", "new york": "JFK", boston: "BOS",
  philadelphia: "PHL", honolulu: "HNL", anchorage: "ANC", vancouver: "YVR", toronto: "YYZ",
  montreal: "YUL", "mexico city": "MEX", cancun: "CUN", london: "LHR", paris: "CDG", rome: "FCO",
  madrid: "MAD", barcelona: "BCN", lisbon: "LIS", amsterdam: "AMS", frankfurt: "FRA", munich: "MUC",
  zurich: "ZRH", geneva: "GVA", vienna: "VIE", prague: "PRG", berlin: "BER", dublin: "DUB",
  edinburgh: "EDI", copenhagen: "CPH", stockholm: "ARN", oslo: "OSL", helsinki: "HEL", athens: "ATH",
  istanbul: "IST", "tel aviv": "TLV", dubai: "DXB", doha: "DOH", delhi: "DEL", mumbai: "BOM",
  singapore: "SIN", bangkok: "BKK", "hong kong": "HKG", tokyo: "HND", osaka: "KIX", seoul: "ICN",
  beijing: "PEK", shanghai: "PVG", taipei: "TPE", manila: "MNL", sydney: "SYD", melbourne: "MEL",
  auckland: "AKL", "buenos aires": "EZE", "sao paulo": "GRU", "rio de janeiro": "GIG", lima: "LIM",
  bogota: "BOG", santiago: "SCL", johannesburg: "JNB", "cape town": "CPT", cairo: "CAI",
  nairobi: "NBO", casablanca: "CMN", reykjavik: "KEF",
};

function toIATA(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(n)) return n.toUpperCase();
  if (CITY_IATA[n]) return CITY_IATA[n];
  for (const key of Object.keys(CITY_IATA)) {
    if (n.includes(key) || key.includes(n)) return CITY_IATA[key];
  }
  return null;
}

// Direct booking sites per carrier — the "book it" handoff the audit
// flagged as missing. Fuzzy-matched by name; unknown carriers fall back
// to the Google Flights link in Purchase Strategy.
const CARRIER_SITES = {
  United: "https://www.united.com", "Air Canada": "https://www.aircanada.com", Lufthansa: "https://www.lufthansa.com",
  "Singapore Airlines": "https://www.singaporeair.com", ANA: "https://www.ana.co.jp/en/us/", "Turkish Airlines": "https://www.turkishairlines.com",
  American: "https://www.aa.com", "Japan Airlines": "https://www.jal.co.jp/us/en/", "British Airways": "https://www.britishairways.com", "Qatar Airways": "https://www.qatarairways.com",
  "Cathay Pacific": "https://www.cathaypacific.com", Qantas: "https://www.qantas.com", Delta: "https://www.delta.com",
  "Air France": "https://wwws.airfrance.us", KLM: "https://www.klm.com", "Korean Air": "https://www.koreanair.com",
  "Alaska Airlines": "https://www.alaskaair.com", Emirates: "https://www.emirates.com", JetBlue: "https://www.jetblue.com",
};

// Susan's rule (2026-07-19): prioritize Asia-based carriers on Asia-bound
// trips — their home-market product quality (seat, service, food) is a
// real comfort difference the cabin+stops model can't see. Applied as a
// +12 Comfort bonus, surfaced in the insights whenever it's active so the
// preference is visible, never a hidden thumb on the scale.
const ASIAN_CARRIERS = ["ANA", "All Nippon", "Japan Airlines", "JAL", "Singapore", "Cathay", "Korean Air", "Asiana", "EVA", "China Airlines", "Air China", "China Eastern", "China Southern", "Thai", "Vietnam Airlines", "Philippine Airlines", "Malaysia Airlines", "Garuda", "Air India", "Vistara", "Starlux", "Zipair"];
const ASIA_COMFORT_BONUS = 12;

function isAsianCarrier(name) {
  const n = (name || "").toLowerCase();
  return ASIAN_CARRIERS.some((c) => n.includes(c.toLowerCase()));
}

function destinationInAsia(inputs) {
  const c = lookupCoords(inputs.destination);
  return Boolean(c && c[1] >= 60 && c[1] <= 150 && c[0] >= -10 && c[0] <= 60);
}

function carrierSite(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const [key, url] of Object.entries(CARRIER_SITES)) {
    if (n.includes(key.toLowerCase()) || key.toLowerCase().includes(n)) return url;
  }
  return null;
}

const PRIORITY_WEIGHTS = {
  Cheapest:                 { Cost: 1.0, Comfort: 0.1, Upgrade: 0.1, Award: 0.2, Flexibility: 0.1, Risk: 0.2 },
  "Best Value":              { Cost: 0.6, Comfort: 0.4, Upgrade: 0.2, Award: 0.3, Flexibility: 0.3, Risk: 0.3 },
  Fastest:                   { Cost: 0.1, Comfort: 0.3, Upgrade: 0.1, Award: 0.0, Flexibility: 0.1, Risk: 0.7 },
  "Most Comfortable":        { Cost: 0.1, Comfort: 1.0, Upgrade: 0.2, Award: 0.1, Flexibility: 0.2, Risk: 0.2 },
  "Best Upgrade Opportunity": { Cost: 0.1, Comfort: 0.3, Upgrade: 1.0, Award: 0.1, Flexibility: 0.1, Risk: 0.1 },
  "Best Use of Miles":        { Cost: 0.1, Comfort: 0.1, Upgrade: 0.2, Award: 1.0, Flexibility: 0.1, Risk: 0.1 },
  // Cost raised 0.3 → 1.4 (2026-07-19, Susan's call after the ANA-vs-United
  // case): under "Best Overall", a fare at ~half price now outranks a
  // nonstop, while modest price gaps still lose to the better-rounded
  // itinerary. Tuned against that real case — see CLAUDE.md.
  "Best Overall Experience":  { Cost: 1.4, Comfort: 0.5, Upgrade: 0.4, Award: 0.3, Flexibility: 0.3, Risk: 0.3 },
};

const DIMENSIONS = ["Cost", "Comfort", "Upgrade", "Award", "Flexibility", "Risk"];
const DIM_LABEL = { Cost: "Cost", Comfort: "Comfort", Upgrade: "Upgrade Potential", Award: "Award Value", Flexibility: "Flexibility", Risk: "Risk (inverted — higher = lower risk)" };

/* ---------- small deterministic RNG so re-running the same inputs
   reproduces the same result, like a real model would ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function fmtUSD(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

/* ---------- candidate generation ---------- */

function candidatePool(inputs) {
  let pool = ALL_CARRIERS.slice();
  if (destinationInAsia(inputs)) {
    pool = pool.filter((c) => !NO_OWN_ASIA_SERVICE.includes(c));
  }
  if (inputs.preferredAlliances.length) {
    pool = pool.filter((c) => inputs.preferredAlliances.some((al) => ALLIANCES[al].includes(c)));
  }
  if (inputs.preferredAirlines.length) {
    const preferred = pool.filter((c) => inputs.preferredAirlines.includes(c));
    if (preferred.length) pool = preferred.concat(pool.filter((c) => !preferred.includes(c)));
  }
  if (inputs.avoidAirlines.length) {
    pool = pool.filter((c) => !inputs.avoidAirlines.includes(c));
  }
  if (!pool.length) pool = ALL_CARRIERS.slice();
  return pool;
}

function allianceOf(carrier) {
  for (const [al, list] of Object.entries(ALLIANCES)) if (list.includes(carrier)) return al;
  return "Unaligned";
}

// Route geometry shared by both the modeled and live paths: real
// great-circle distance when both endpoints are in the city table; a
// stated generic long-haul assumption when not.
function routeContext(inputs) {
  const via = (inputs.viaCity || "").trim();
  let route;
  if (via) {
    // Via routing: real geometry for both legs, summed. Forces at least
    // one stop and carries a small multi-city fare premium below.
    const a = lookupCoords(inputs.origin), v = lookupCoords(via), b = lookupCoords(inputs.destination);
    if (a && v && b) {
      const leg1 = haversineKm(a, v), leg2 = haversineKm(v, b);
      const direct = haversineKm(a, b);
      route = { km: leg1 + leg2, known: true, via, legs: [leg1, leg2], directKm: direct };
    } else {
      route = { km: null, known: false, via };
    }
  } else {
    route = routeDistanceKm(inputs.origin, inputs.destination);
  }
  const effKm = route.km || 7500;
  // Fares scale with distance: ~0.25× base for a short domestic hop up to
  // ~1.7× for an ultra-long-haul, anchored so base = a ~9,000 km long-haul.
  // Via routings carry a ~6% multi-city premium on top.
  const distFactor = clamp(0.22 + 0.78 * (effKm / 9000), 0.22, 1.7) * (via ? 1.06 : 1);
  const milesFactor = clamp(0.4 + 0.6 * (effKm / 9000), 0.4, 1.5);
  const airMinutesNonstop = Math.round((effKm / 850) * 60 + 45); // 850 km/h cruise + ground overhead
  return { route, effKm, distFactor, milesFactor, airMinutesNonstop };
}

function fuzzyCarrierScore(name) {
  if (UPGRADE_FRIENDLY[name] != null) return UPGRADE_FRIENDLY[name];
  const n = (name || "").toLowerCase();
  for (const key of Object.keys(UPGRADE_FRIENDLY)) {
    if (n.includes(key.toLowerCase()) || key.toLowerCase().includes(n)) return UPGRADE_FRIENDLY[key];
  }
  return 50;
}

function fuzzyAlliance(name) {
  const n = (name || "").toLowerCase();
  for (const [al, list] of Object.entries(ALLIANCES)) {
    if (list.some((c) => n.includes(c.toLowerCase()) || c.toLowerCase().includes(n))) return al;
  }
  return "Unaligned";
}

function generateCandidates(inputs) {
  const seedStr = [inputs.origin, inputs.destination, inputs.departDate, inputs.returnDate, inputs.cabin, inputs.maxBudget].join("|");
  const rng = mulberry32(hashSeed(seedStr));
  const pool = candidatePool(inputs);
  const flexDays = { Exact: 0, "±1 day": 1, "±3 days": 3, "±7 days": 7 }[inputs.dateFlexibility] || 0;

  const { route, effKm, distFactor, milesFactor, airMinutesNonstop } = routeContext(inputs);

  const fareTiers = ["Basic", "Standard", "Flexible"];
  const candidates = [];
  const n = Math.max(5, Math.min(7, pool.length + 2));

  for (let i = 0; i < n; i++) {
    const carrier = pool[i % pool.length];
    const stopsRoll = rng();
    // A via routing can't be nonstop — the stopover IS a stop.
    const minStops = route.via ? 1 : 0;
    const stops = Math.max(minStops, inputs.maxStops <= 0 ? 0 : Math.min(Math.max(inputs.maxStops, minStops), Math.floor(stopsRoll * (inputs.maxStops + 1))));
    const fareTier = fareTiers[clamp(Math.floor(rng() * fareTiers.length) + (inputs.cabin === "Business" || inputs.cabin === "First" ? 1 : 0), 0, 2)];
    const dateOffset = flexDays ? Math.round((rng() * 2 - 1) * flexDays) : 0;

    // price model: per-cabin round-trip base scaled by route distance,
    // seeded noise, stops discount, fare-tier adjustment, then a
    // distance-scaled per-cabin floor. Planning model, not a fetched fare
    // — see the eyebrow banner on this page.
    let base = (CABIN_BASE[inputs.cabin] || CABIN_BASE.Economy) * distFactor;
    base *= 1 + (0.5 - rng()) * 0.5; // +/-25% noise
    base -= stops * (CABIN_STOP_DISCOUNT[inputs.cabin] || 30);
    base *= fareTier === "Basic" ? 0.82 : fareTier === "Flexible" ? 1.18 : 1;
    if (dateOffset !== 0) base *= 1 - Math.min(0.12, Math.abs(dateOffset) * 0.02);
    const price = Math.max(Math.round((CABIN_FLOOR[inputs.cabin] || 200) * distFactor), Math.round(base));

    const scores = {};
    scores.Cost = clamp(100 - (price / Math.max(1, inputs.maxBudget)) * 65, 4, 100);
    scores.Comfort = clamp((CABIN_COMFORT_BASE[inputs.cabin] || 50) - stops * 11 + (stops === 0 ? 6 : 0) + (destinationInAsia(inputs) && isAsianCarrier(carrier) ? ASIA_COMFORT_BONUS : 0), 5, 100);
    const upgradeFriendly = UPGRADE_FRIENDLY[carrier] ?? 50;
    scores.Upgrade = clamp(
      upgradeFriendly - (inputs.cabin === "First" ? 35 : inputs.cabin === "Business" ? 12 : 0) + (inputs.cabin === "Economy" || inputs.cabin === "Best Value" ? 6 : 0),
      3, 100
    );
    const range = AWARD_RANGES[inputs.cabin] || AWARD_RANGES.Economy;
    const milesMid = (range.milesLow + range.milesHigh) / 2;
    const feesMid = (range.feesLow + range.feesHigh) / 2;
    const cpp = ((price - feesMid) / milesMid) * 100; // cents per mile if redeemed vs this cash price
    scores.Award = clamp(cpp * 42, 2, 100);
    scores.Flexibility = clamp((fareTier === "Flexible" ? 88 : fareTier === "Standard" ? 55 : 22) + (inputs.cabin === "Business" || inputs.cabin === "First" ? 8 : 0), 5, 100);
    const monthRisk = seasonalRisk(inputs.departDate);
    scores.Risk = clamp(100 - stops * 18 - monthRisk, 5, 100);

    // miles+cash either/or: an estimated miles price for THIS candidate,
    // interpolated within the cabin's distance-scaled reference range by
    // where the cash price sits in its own plausible band. Planning
    // figure, not a quote.
    const mLow = range.milesLow * milesFactor, mHigh = range.milesHigh * milesFactor;
    const priceBand = clamp((price - (CABIN_FLOOR[inputs.cabin] || 200) * distFactor) / Math.max(1, (CABIN_BASE[inputs.cabin] || 620) * distFactor * 1.4), 0, 1);
    const milesEst = Math.round((mLow + (mHigh - mLow) * priceBand) / 5000) * 5000 || 5000;
    const feesEst = Math.round(range.feesLow + (range.feesHigh - range.feesLow) * priceBand);
    const candCpp = ((price - feesEst) / Math.max(1, milesEst)) * 100;

    // travel time from route geometry: nonstop air time, plus per-stop
    // layover and routing detour — never a constant.
    const travelMinutes = airMinutesNonstop + stops * (105 + Math.round(rng() * 30)) + Math.round(stops * airMinutesNonstop * 0.08);

    candidates.push({
      id: i, carrier, alliance: allianceOf(carrier), stops, fareTier, price, dateOffset,
      cabin: inputs.cabin === "Best Value" ? (cpp * 42 > 60 ? "Business" : "Economy") : inputs.cabin,
      scores, cpp, milesMid, feesMid,
      milesEst, feesEst, candCpp, payWith: candCpp >= 1.6 ? "miles" : "cash",
      travelMinutes, routeKm: route.km, routeKnown: route.known,
      via: route.via || null, routeLegs: route.legs || null, directKm: route.directKm || null,
      aircraft: pickAircraft(rng, stops, inputs.cabin, effKm),
    });
  }
  return candidates;
}

function pickAircraft(rng, stops, cabin, km) {
  const wide = ["Boeing 787-9", "Airbus A350-900", "Boeing 777-300ER", "Airbus A330-300"];
  const narrow = ["Airbus A321neo", "Boeing 737 MAX 9", "Airbus A320"];
  // Aircraft follows route distance: long-haul flies widebodies, short
  // hops fly narrowbodies, with First always on a widebody.
  const wideChance = cabin === "First" || km > 5500 ? 1 : km > 2500 ? 0.5 : 0.06;
  const pool = rng() < wideChance ? wide : narrow;
  return pool[Math.floor(rng() * pool.length)];
}

function seasonalRisk(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d)) return 8;
  const m = d.getMonth(); // 0=Jan
  // rough, general seasonality: winter storm season + summer peak congestion
  if (m === 11 || m === 0 || m === 1) return 22;
  if (m === 6 || m === 5) return 16;
  if (m === 10) return 12;
  return 8;
}

/* ---------- live offers → scored candidates ----------
 * Takes REAL fares (from the /api/fares Netlify Function, a proxy to
 * SerpApi's Google Flights engine) and runs them through the exact same
 * six-dimension scoring the model uses — the weighting framework is the
 * product; the data source upgraded underneath it. Prices are real; the
 * miles estimate stays a distance-scaled planning range (award SPACE is
 * still not searched — that's labeled in the UI).
 */
function buildLiveCandidates(inputs, offers) {
  const { route, effKm, milesFactor, distFactor } = routeContext(inputs);
  const travelers = inputs.travelers || 1;
  const avoid = (inputs.avoidAirlines || []).map((a) => a.toLowerCase());
  const range = AWARD_RANGES[inputs.cabin] || AWARD_RANGES.Economy;
  const mLow = range.milesLow * milesFactor, mHigh = range.milesHigh * milesFactor;

  return offers
    .filter((o) => !avoid.some((a) => (o.carrier || "").toLowerCase().includes(a)))
    .slice(0, 12)
    .map((o, i) => {
      const price = Math.round(o.priceTotal / travelers); // per person, matching the model's display convention
      const stops = Math.max(0, o.stops || 0);
      const cabin = inputs.cabin === "Best Value" ? (o.cabins && o.cabins.includes("BUSINESS") ? "Business" : "Economy") : inputs.cabin;

      const priceBand = clamp((price - (CABIN_FLOOR[cabin] || 200) * distFactor) / Math.max(1, (CABIN_BASE[cabin] || 620) * distFactor * 1.4), 0, 1);
      const milesEst = Math.round((mLow + (mHigh - mLow) * priceBand) / 5000) * 5000 || 5000;
      const feesEst = Math.round(range.feesLow + (range.feesHigh - range.feesLow) * priceBand);
      const candCpp = ((price - feesEst) / Math.max(1, milesEst)) * 100;

      const scores = {};
      scores.Cost = clamp(100 - (price / Math.max(1, inputs.maxBudget)) * 65, 4, 100);
      scores.Comfort = clamp((CABIN_COMFORT_BASE[cabin] || 50) - stops * 11 + (stops === 0 ? 6 : 0) + (destinationInAsia(inputs) && isAsianCarrier(o.carrier) ? ASIA_COMFORT_BONUS : 0), 5, 100);
      scores.Upgrade = clamp(fuzzyCarrierScore(o.carrier) - (cabin === "First" ? 35 : cabin === "Business" ? 12 : 0) + (cabin === "Economy" || cabin === "Best Value" ? 6 : 0), 3, 100);
      scores.Award = clamp(candCpp * 42, 2, 100);
      scores.Flexibility = clamp(55 + (cabin === "Business" || cabin === "First" ? 8 : 0), 5, 100);
      scores.Risk = clamp(100 - stops * 18 - seasonalRisk(inputs.departDate), 5, 100);

      return {
        id: i, carrier: o.carrier || o.carrierCode, alliance: fuzzyAlliance(o.carrier), stops,
        fareTier: "Standard", price, dateOffset: 0, cabin, scores,
        cpp: candCpp, milesMid: milesEst, feesMid: feesEst,
        milesEst, feesEst, candCpp, payWith: candCpp >= 1.6 ? "miles" : "cash",
        travelMinutes: o.durationMinutes || null, // provider returns outbound (one-way) minutes
        routeKm: route.km, routeKnown: route.known,
        aircraft: o.aircraft || (o.bookableSeats ? `${o.bookableSeats} bookable seats` : "—"),
        availLabel: o.aircraft ? "Aircraft" : "Availability",
        live: true, priceTotal: Math.round(o.priceTotal), lastTicketingDate: o.lastTicketingDate || null,
      };
    });
}

/* ---------- priority suggestion ----------
 * Recommends a primary + runner-up optimization lens from the trip's own
 * characteristics — route distance, cabin, budget vs the typical modeled
 * fare, purpose, party size, and whether the saved miles balance can
 * realistically cover this route. Rule-based and transparent: every
 * suggestion states its reason, and it's a suggestion the user applies
 * with one click, never an override.
 */
function suggestPriorities(inputs) {
  const { effKm, distFactor, milesFactor } = routeContext(inputs);
  const longHaul = effKm >= 8000;
  const typicalFare = Math.round((CABIN_BASE[inputs.cabin] || CABIN_BASE.Economy) * distFactor);
  const tightBudget = (inputs.maxBudget || 0) > 0 && inputs.maxBudget < typicalFare * 0.9;
  const biggestBalance = (inputs.programBalances || []).reduce((m, p) => Math.max(m, p.balance), 0);
  const econAwardLow = Math.round(AWARD_RANGES.Economy.milesLow * milesFactor);
  const milesUseful = biggestBalance >= econAwardLow;
  const kmStr = effKm.toLocaleString() + " km";

  if (tightBudget) {
    return { primary: "Cheapest", secondary: longHaul ? "Best Value" : "Best Overall Experience",
      reason: `your $${inputs.maxBudget.toLocaleString()} budget sits below the ~$${typicalFare.toLocaleString()} typical ${inputs.cabin} fare for this ${kmStr} route — price has to lead.` };
  }
  if ((inputs.cabin === "Economy" || inputs.cabin === "Best Value") && longHaul && milesUseful) {
    return { primary: "Best Upgrade Opportunity", secondary: "Best Use of Miles",
      reason: `${kmStr} in Economy is where an upgrade pays off most, and your ${biggestBalance.toLocaleString()}-mile balance clears the ~${econAwardLow.toLocaleString()}-mile bar to be in play.` };
  }
  if ((inputs.cabin === "Economy" || inputs.cabin === "Best Value") && longHaul) {
    return { primary: "Best Overall Experience", secondary: "Most Comfortable",
      reason: `${kmStr} is a long day in Economy — comfort (nonstops, better carriers) is worth weighting alongside the rounded view.` };
  }
  if (inputs.tripPurpose === "Business" && inputs.dateFlexibility === "Exact") {
    return { primary: "Fastest", secondary: "Best Overall Experience",
      reason: `a business trip on exact dates — total travel time and low disruption risk usually matter more than saving a little.` };
  }
  if (inputs.cabin === "Business" || inputs.cabin === "First") {
    return { primary: "Best Value", secondary: milesUseful ? "Best Use of Miles" : "Most Comfortable",
      reason: milesUseful
        ? `premium cabins are where redemptions run strongest — with ${biggestBalance.toLocaleString()} miles saved, value and miles are the right two lenses.`
        : `${inputs.cabin} fares vary wildly for near-identical products on this route — value comparison beats any single dimension.` };
  }
  // Saved "typical travel style" preference — applied ONLY as a fallback,
  // after every trip-specific signal above has had a chance to fire, so a
  // saved default never overrides what this particular trip's own numbers
  // say. Kept as a small lookup table + pure function (travelStyleFallback)
  // so it's testable without the rest of suggestPriorities' context.
  const styleFallback = travelStyleFallback(inputs.travelStyle);
  if (styleFallback) {
    return { primary: styleFallback.primary, secondary: styleFallback.secondary,
      reason: `${styleFallback.note} — nothing about this specific trip overrides it.` };
  }

  return { primary: "Best Overall Experience", secondary: "Best Value",
    reason: `nothing about this trip forces a single dimension — the balanced lens with a value runner-up fits.` };
}

// 2026-07-21: saved preferences & trip memory, phase 07's fuller slice
// (the wallet shipped first, 2026-07-14, ahead of this). Three small pure
// functions, each reading a saved-preference field from `inputs` — never
// touching the six-dimension scores themselves, per "radical simplicity":
// these personalize the SUGGESTION and the INSIGHTS, not the scoring math.
const TRAVEL_STYLE_FALLBACK = {
  Relaxed: { primary: "Most Comfortable", secondary: "Best Overall Experience", note: `your saved travel style is "Relaxed" — fewer connections and more buffer over price` },
  Efficient: { primary: "Fastest", secondary: "Best Overall Experience", note: `your saved travel style is "Efficient" — minimizing total travel time` },
  Luxury: { primary: "Best Upgrade Opportunity", secondary: "Most Comfortable", note: `your saved travel style is "Luxury" — comfort and upgrade potential over price` },
};

function travelStyleFallback(travelStyle) {
  return TRAVEL_STYLE_FALLBACK[travelStyle] || null;
}

// Saved "airports to avoid" preference, checked against the fields that
// are honest to check: origin, destination, preferred/nearby airports,
// and the via city. The candidate model only generates a STOP COUNT per
// itinerary, never a specific connection airport — so this deliberately
// does NOT claim to catch a disliked airport used as a connection, and
// buildInsights says so explicitly when it fires (never a silent or
// overclaimed match).
function flagsDislikedAirport(inputs) {
  const disliked = (inputs.dislikedAirports || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!disliked.length) return null;
  const rawFields = [inputs.origin, inputs.destination, inputs.preferredAirport, inputs.viaCity]
    .concat((inputs.airportFlexibility || "").split(","))
    .map((s) => (s || "").trim())
    .filter(Boolean);
  // Check both the raw text (a saved city name) and its resolved IATA code
  // (toIATA, the same city→code table the live search uses) — a saved
  // "LHR" needs to match a trip field of "London" and vice versa.
  const fields = rawFields.flatMap((f) => {
    const code = toIATA(f);
    return [f.toLowerCase(), code ? code.toLowerCase() : null].filter(Boolean);
  });
  for (const d of disliked) {
    if (fields.some((f) => f.includes(d) || d.includes(f))) return d;
  }
  return null;
}

// Saved "upgrade wins" log — free-text history the user adds to after a
// successful upgrade. If any past entry mentions the recommended
// itinerary's carrier, that's surfaced as a reason to try the same play
// again. Substring match on free text only, same fuzziness as the rest of
// this file's carrier matching — never scored, just surfaced.
function matchUpgradeWinCarrier(upgradeWins, carrierName) {
  if (!Array.isArray(upgradeWins) || !carrierName) return null;
  const c = carrierName.toLowerCase();
  return upgradeWins.find((w) => w && typeof w.text === "string" && w.text.toLowerCase().includes(c)) || null;
}

/* ---------- weighting from the ranked priority list ---------- */

function computeWeights(priorityRanks) {
  // priorityRanks: { "Cheapest": 1, "Best Value": 2, ... } rank 1 = most important
  const total = Object.keys(priorityRanks).length || 1;
  const dimWeights = { Cost: 0, Comfort: 0, Upgrade: 0, Award: 0, Flexibility: 0, Risk: 0 };
  for (const [priority, rank] of Object.entries(priorityRanks)) {
    const rankWeight = (total + 1 - rank) / total; // rank 1 -> heaviest
    const vec = PRIORITY_WEIGHTS[priority];
    if (!vec) continue;
    for (const dim of DIMENSIONS) dimWeights[dim] += vec[dim] * rankWeight;
  }
  const sum = DIMENSIONS.reduce((s, d) => s + dimWeights[d], 0) || 1;
  for (const dim of DIMENSIONS) dimWeights[dim] = dimWeights[dim] / sum;
  return dimWeights;
}

function weightedScore(scores, weights) {
  return DIMENSIONS.reduce((s, d) => s + scores[d] * weights[d], 0);
}

/* ---------- purchase timing ---------- */

function purchaseTiming(inputs) {
  const depart = new Date(inputs.departDate + "T12:00:00");
  const today = new Date();
  const daysOut = Math.round((depart - today) / 86400000);
  if (isNaN(daysOut)) return { verdict: "monitor", days: null, reason: "No valid departure date entered — set one to get a timing read." };
  if (daysOut < 0) return { verdict: "buy", days: daysOut, reason: "Departure date is in the past — re-check the date." };
  if (daysOut <= 20) return { verdict: "buy", days: daysOut, reason: `Only ${daysOut} days out. Close-in fares typically climb from here; the risk of waiting outweighs any further discount.` };
  if (daysOut <= 60) return { verdict: "buy", days: daysOut, reason: `${daysOut} days out is inside the typical low-fare window for most routes (roughly 3–8 weeks out). Prices are more likely to drift up than down from here.` };
  if (daysOut <= 180) return { verdict: "wait", days: daysOut, reason: `${daysOut} days out — still early. Fares this far ahead are unsettled; monitor for 2–3 weeks and set a price watch rather than booking today.` };
  return { verdict: "monitor", days: daysOut, reason: `${daysOut} days out is very early — most airlines haven't released their real pricing yet for this window. Set an alert and revisit closer to the 4–6 month mark.` };
}

/* ---------- award recommendation ---------- */

function awardRecommendation(best, inputs, programBalances) {
  const range = AWARD_RANGES[best.cabin] || AWARD_RANGES[inputs.cabin] || AWARD_RANGES.Economy;
  const milesMid = Math.round((range.milesLow + range.milesHigh) / 2);
  const feesMid = Math.round((range.feesLow + range.feesHigh) / 2);
  // ONE verdict per itinerary: the candidate's own cpp (best.candCpp) is
  // the single source of truth for pay-with everywhere — exec summary,
  // hero, and this card must never disagree (audit finding). The chart
  // range is shown as a range of possible cpp outcomes, not a second
  // verdict.
  const cpp = best.candCpp != null ? best.candCpp : ((best.price - feesMid) / milesMid) * 100;
  const cppBestCase = ((best.price - range.feesLow) / Math.max(1, range.milesLow)) * 100;
  const cppWorstCase = ((best.price - range.feesHigh) / Math.max(1, range.milesHigh)) * 100;
  const alliance = best.alliance;
  const relevantPrograms = programBalances.filter((p) => p.balance > 0);
  const strong = cpp >= 1.6;
  return { milesLow: range.milesLow, milesHigh: range.milesHigh, milesMid, feesMid, cpp, cppBestCase, cppWorstCase, strong, alliance, relevantPrograms, cabin: best.cabin };
}

/* ---------- upgrade tactics ----------
 * Concrete, ordered plays to land the cabin you actually want — the
 * "do this creative thing to get what you want" layer. Grounded in the
 * bid-upgrade mechanics documented by TPG and Going (July 2026): bid
 * 20–40% of the fare gap, slightly above the minimum; most bid windows
 * close 48–72h out (Virgin Atlantic opens 7 days out); typical winning
 * long-haul business bids run $300–600; if the bid loses, ask at
 * check-in — counter-offers there are common.
 */

function fmtDateShort(d) {
  return isNaN(d) ? null : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function daysBefore(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d)) return null;
  d.setDate(d.getDate() - days);
  return d;
}

// An ACTION PLAN, not a description: each step says when to do it (real
// dates computed from the departure date), what exactly to do, and with
// what numbers (bid amounts computed from this itinerary's modeled fare
// gap). Ordered as a timeline from booking day to the gate.
//
// When the booked cabin is Economy, the plan targets BUSINESS — the most
// common real goal — and opens with the three priced routes to get there
// (the Premium Economy ladder, the direct bid, miles + copay), because
// "upgrade one cabin" advice buries what the traveler actually wants.
function upgradeTactics(best, inputs) {
  const tactics = [];
  const fromEconomy = best.cabin === "Economy" || best.cabin === "Best Value";
  const cabinAbove = fromEconomy ? "Business" : { "Premium Economy": "Business", Business: "First" }[best.cabin];
  if (!cabinAbove) {
    tactics.push({ when: "Now", title: "You're booking top cabin — the play is price, not position", detail: "No upgrade path above First. Action: price Business on the same flights before paying — it's typically ~55% of the First fare for most of the experience." });
    return tactics;
  }

  if (fromEconomy) {
    // Economy → Business: price all three routes for THIS trip. Cabin
    // multipliers come from the same hand-maintained CABIN_BASE table the
    // fare model uses; applied to the (live or modeled) Economy price.
    const econ = best.price;
    const pePrice = Math.round(econ * (CABIN_BASE["Premium Economy"] / CABIN_BASE.Economy));      // ~2×
    const bizPrice = Math.round(econ * (CABIN_BASE.Business / CABIN_BASE.Economy));               // ~5.8×
    const ladderBidLow = Math.round(((bizPrice - pePrice) * 0.2) / 10) * 10;
    const ladderBidHigh = Math.round(((bizPrice - pePrice) * 0.4) / 10) * 10;
    const ladderLow = pePrice + ladderBidLow, ladderHigh = pePrice + ladderBidHigh;
    const directBidLow = Math.round(((bizPrice - econ) * 0.2) / 10) * 10;
    const directBidHigh = Math.round(((bizPrice - econ) * 0.4) / 10) * 10;
    // Upgrade-award reference range (round-trip, one cabin jump at ticketing
    // time), scaled to route distance — hand-maintained, not a live chart.
    const kmScale = clamp(0.4 + 0.6 * ((best.routeKm || 7500) / 9000), 0.4, 1.5);
    const upMilesLow = Math.round((40000 * kmScale) / 5000) * 5000;
    const upMilesHigh = Math.round((120000 * kmScale) / 5000) * 5000;
    const biggestBalance = (inputs.programBalances || []).reduce((m, p) => Math.max(m, p.balance), 0);
    const ladderSavings = Math.max(0, Math.round((1 - ladderHigh / bizPrice) * 100));

    tactics.push({
      when: "Your goal",
      title: `Economy → Business: three routes, priced for this trip`,
      detail: `Business outright runs ~${fmtUSD(bizPrice)} vs your ${fmtUSD(econ)} Economy fare. ` +
        `<strong>Route 1 — the ladder (usually cheapest reliable):</strong> book Premium Economy at ~${fmtUSD(pePrice)}, then bid ${fmtUSD(ladderBidLow)}–${fmtUSD(ladderBidHigh)} for the PE→Business jump — lands Business for ~${fmtUSD(ladderLow)}–${fmtUSD(ladderHigh)} all-in, roughly ${ladderSavings}% under booking it outright, and PE is your worst case, not a middle seat. ` +
        `<strong>Route 2 — the direct bid:</strong> stay in Economy and bid ${fmtUSD(directBidLow)}–${fmtUSD(directBidHigh)}; cheapest when it clears, but Economy→Business bids lose more often than PE→Business ones, and your fallback is the Economy seat. ` +
        `<strong>Route 3 — miles + copay:</strong> typically ~${(upMilesLow / 1000).toFixed(0)}k–${(upMilesHigh / 1000).toFixed(0)}k miles round-trip plus a cash copay for this distance${biggestBalance >= upMilesLow ? ` — your ${biggestBalance.toLocaleString()}-mile balance covers the low end, check it first` : biggestBalance > 0 ? ` — your ${biggestBalance.toLocaleString()}-mile balance falls short of the typical range` : ""}; requires an upgradeable (non-Basic) fare and award space, so confirm before ticketing.`,
    });
  }

  // Fare gap to the target cabin, and the 20–40% bid band from it.
  const ratio = (CABIN_BASE[cabinAbove] || 3600) / (CABIN_BASE[best.cabin] || 620);
  const gap = Math.max(150, Math.round(best.price * (ratio - 1)));
  const bidLow = Math.round((gap * 0.2) / 10) * 10;
  const bidHigh = Math.round((gap * 0.4) / 10) * 10;
  const bidDate = fmtDateShort(daysBefore(inputs.departDate, 4));
  const seatMapDate = fmtDateShort(daysBefore(inputs.departDate, 3));
  const checkInDate = fmtDateShort(daysBefore(inputs.departDate, 1));

  tactics.push({
    when: "At booking",
    title: fromEconomy ? `Commit to a route, then book the fare that keeps it open` : `Book Standard, not Basic — it's the entry ticket`,
    detail: fromEconomy
      ? `Ladder route: book Premium Economy (Standard tier) directly. Bid or miles route: book Economy at the Standard tier or above — Basic fares are excluded from bids, mileage upgrades, and complimentary lists alike. Either way, immediately check two things on ${best.carrier}'s booking page: "upgrade with miles" pricing, and whether an upgrade-bid invitation appears.`
      : `Basic/deep-discount buckets are excluded from most upgrade paths entirely. On ${best.carrier}, book at least the Standard tier, then immediately check two things on the booking page: "upgrade with miles" pricing, and whether an upgrade-bid invitation is offered.`,
  });
  tactics.push({
    when: "Same week",
    title: `Price the miles + copay upgrade first`,
    detail: `Before any cash bid: check what ${best.carrier} charges in miles + copay to move this booking to ${cabinAbove}. It's often the best redemption rate in the whole program and beats a cash bid of the same value. If the miles + copay package values out under ~${fmtUSD(gap * 0.35)} all-in, take it and skip the rest of this list.`,
  });
  tactics.push({
    when: bidDate ? `By ${bidDate}` : "T−4 days",
    title: `Place your bid: $${bidLow.toLocaleString()}–$${bidHigh.toLocaleString()} for ${cabinAbove}`,
    detail: `That's 20–40% of this itinerary's modeled ~$${gap.toLocaleString()} fare gap. Bid 5–10% above the stated minimum — most people bid the exact minimum, so a small premium wins disproportionately often. Windows close 48–72h out on most carriers. Bids are per segment, per passenger.`,
  });
  tactics.push({
    when: seatMapDate ? seatMapDate : "T−3 days",
    title: `Check the ${cabinAbove} seat map before the window closes`,
    detail: `Open ${best.carrier}'s seat map for your flight: mostly-empty ${cabinAbove} → your low bid likely clears, leave it. Nearly full → cancel or lower the bid (most carriers allow changes until ~72h out) and pivot to the check-in play instead.`,
  });
  tactics.push({
    when: checkInDate ? `${checkInDate} (T−24h)` : "T−24h, at check-in",
    title: `Check in the minute it opens and look for the counter-offer`,
    detail: `Rejected bids are routinely followed by a cheaper flat-price upgrade offer at online check-in. If none appears, ask the desk agent, specifically: "Are paid upgrades to ${cabinAbove} available on this flight?" Note the price; it's sometimes below your losing bid.`,
  });
  tactics.push({
    when: "Departure day",
    title: `Last ask at the gate`,
    detail: `If ${cabinAbove} still shows open seats, ask the gate agent once, early in boarding prep. Undersold cabins get cleared at the gate at the steepest discounts — this costs nothing to ask.`,
  });
  if (inputs.tripPurpose === "Business" || inputs.tripPurpose === "Both" || (inputs.travelers || 1) > 1) {
    tactics.push({
      when: "Creative play",
      title: `Split the cabin across your party`,
      detail: `Book ONE ${cabinAbove} seat and the rest in ${best.cabin}, then trade off in-flight. For ${inputs.travelers || 2} travelers that's roughly $${Math.round(gap / (inputs.travelers || 2)).toLocaleString()} per person for everyone to get time up front — a fraction of upgrading every seat.`,
    });
  }
  tactics.push({
    when: "Creative play",
    title: `Price ${cabinAbove} outright from your alternate airports`,
    detail: `Before paying ~$${gap.toLocaleString()} to upgrade, price ${cabinAbove} as a fresh booking from ${(inputs.airportFlexibility || "your alternates").split(",").map((s) => s.trim()).filter(Boolean).join(" / ") || "nearby airports"} — a different origin or one positioning hop is sometimes cheaper than the upgrade itself.`,
  });
  return tactics;
}

/* ---------- best-points answers ----------
 * Direct answers to "which airlines offer the best points" and "what are
 * my transfer options" — driven by the dated TPG table above, never
 * presented as timeless truth.
 */

function bestPointsAnswers(inputs) {
  const airlines = Object.entries(POINT_VALUATIONS.airlines).sort((a, b) => b[1] - a[1]);
  const cards = Object.entries(POINT_VALUATIONS.cards).sort((a, b) => b[1] - a[1]);
  const held = (inputs.creditCards || []).filter((c) => TRANSFER_PARTNERS[c]);
  return { asOf: POINT_VALUATIONS.asOf, topAirlines: airlines.slice(0, 6), allAirlines: airlines, topCards: cards, heldCards: held, bonuses: TRANSFER_BONUSES };
}

/* ---------- insights ---------- */

function buildInsights(inputs, candidates, best, weights, timing, usingLive) {
  const insights = [];
  const sorted = candidates.slice().sort((a, b) => b.scores.Cost - a.scores.Cost);
  const cheapest = sorted[0];

  if (inputs.dateFlexibility !== "Exact" && cheapest.dateOffset !== 0) {
    const savings = Math.round((best.price - cheapest.price) > 0 ? best.price - cheapest.price : Math.abs(cheapest.price * 0.08));
    const dir = cheapest.dateOffset > 0 ? "later" : "earlier";
    insights.push(`Shifting your departure ${Math.abs(cheapest.dateOffset)} day${Math.abs(cheapest.dateOffset) === 1 ? "" : "s"} ${dir} tracks toward the lowest fare in this set — worth checking a live calendar view before locking in exact dates.`);
  }

  if (best.stops === 0 && candidates.some((c) => c.stops >= 1)) {
    insights.push(`${best.carrier} nonstop is the highest-scoring option here despite not being the cheapest — the stop-free itinerary meaningfully reduces both Risk and time cost, which matters more than a small fare gap for most travelers.`);
  }

  const upgradeSorted = candidates.slice().sort((a, b) => b.scores.Upgrade - a.scores.Upgrade);
  if (upgradeSorted[0].id !== best.id && upgradeSorted[0].scores.Upgrade - best.scores.Upgrade > 15) {
    insights.push(`${upgradeSorted[0].carrier} scores meaningfully higher on upgrade potential than ${best.carrier} on this shortlist — worth a look if a complimentary or mileage upgrade matters more to you than the small price difference.`);
  }

  if ((inputs.cabin === "Business" || inputs.cabin === "First") && inputs.cabin !== "Economy") {
    insights.push(`Booking Premium Economy or a lower "upgradeable" fare bucket and buying up at check-in or via a mileage upgrade is often cheaper than booking ${inputs.cabin} outright — check ${best.carrier}'s upgrade fare rules before paying full freight.`);
  }

  if (best.fareTier === "Basic") {
    insights.push(`The top-scoring fare is a Basic/restricted fare — expect no free changes and possibly no seat selection or overhead-bin space. If your plans could shift, the Standard fare a bit higher up may be the better real value.`);
  }

  const award = programBalancesFromInputs(inputs);
  const relevant = award.filter((p) => p.balance > 0 && ALLIANCES[best.alliance] && ALLIANCES[best.alliance].some((c) => programMatchesAlliance(p.program, best.alliance)));
  if (relevant.length === 0 && award.some((p) => p.balance > 20000)) {
    insights.push(`You're carrying a meaningful mile balance, but none of it is in a ${best.alliance} program that flies this itinerary directly — a transferable-point transfer (see Award Strategy) is likely your best path to using it here.`);
  }

  if (destinationInAsia(inputs) && candidates.some((c) => isAsianCarrier(c.carrier))) {
    insights.push(`Asia route: Asia-based carriers (ANA, JAL, Singapore, Cathay, EVA…) receive a +${ASIA_COMFORT_BONUS} Comfort bonus here — your standing preference for their home-market product quality, set 2026-07-19. It's visible in the Comfort scores, not a hidden adjustment.`);
  }

  const dislikedMatch = flagsDislikedAirport(inputs);
  if (dislikedMatch) {
    insights.push(`You've saved "${dislikedMatch}" as an airport to avoid, and it shows up in this trip's origin/destination/via/nearby-airport fields — double-check the itinerary. (Stop count is modeled here, not specific connection airports, so this can't check a mid-trip connection — only the fields above.)`);
  }

  const upgradeWinMatch = matchUpgradeWinCarrier(inputs.upgradeWins, best.carrier);
  if (upgradeWinMatch) {
    insights.push(`You've logged a past upgrade win mentioning ${best.carrier} — worth trying the same play again: "${upgradeWinMatch.text}"`);
  }

  // Purchase timing is covered by its own Purchase Strategy card — no
  // duplicate insight here (audit finding: verbatim repetition).

  if (inputs.airportFlexibility && inputs.airportFlexibility.split(",").map((s) => s.trim()).filter(Boolean).length > 1) {
    insights.push(usingLive
      ? `Only your primary airport was searched live — the nearby airports you listed (${inputs.airportFlexibility}) weren't. Nearby-airport comparisons routinely beat date-shifting alone, so price the alternates on Google Flights before booking.`
      : `You've listed more than one workable departure airport. Nearby-airport comparisons routinely surface the largest single savings — price the alternates before locking in the primary routing.`);
  }

  if (best.routeKnown === false) {
    insights.push(`Heads up: ${best.via ? `"${inputs.origin}" / "${best.via}" / "${inputs.destination}" — at least one` : `"${inputs.origin}" → "${inputs.destination}"`} isn't in the hand-maintained city table, so flight times and distance-scaled fares assume a generic 7,500 km long-haul. Add the city to CITY_COORDS in app.js for a real great-circle estimate.`);
  } else if (best.via && best.routeLegs) {
    insights.push(`Routed via ${best.via}: ${best.routeLegs[0].toLocaleString()} km + ${best.routeLegs[1].toLocaleString()} km = ${best.routeKm.toLocaleString()} km each way, vs ~${(best.directKm || 0).toLocaleString()} km direct — about ${Math.max(0, Math.round(((best.routeKm - (best.directKm || best.routeKm)) / Math.max(1, best.directKm || 1)) * 100))}% extra flying for the stopover. Book it as one multi-city ticket, not two one-ways: it's usually cheaper and protects the connection if the first leg delays.`);
  } else if (best.routeKm) {
    insights.push(`Route distance: roughly ${best.routeKm.toLocaleString()} km great-circle each way — flight times and the distance scaling on fares are computed from this geometry, not fabricated per-flight.`);
  }

  insights.push(usingLive
    ? `Prices in this shortlist are live Google Flights quotes; mileage figures remain distance-scaled planning ranges (award space isn't searched yet). See guide.html for exactly what's live vs. modeled.`
    : `This shortlist is scored, not searched — treat the price and mileage figures as planning ranges from a documented model, not a live quote. See guide.html for exactly what's computed vs. what's a hand-maintained reference range.`);

  return insights.slice(0, 8);
}

function programMatchesAlliance(programName, alliance) {
  const map = {
    "Star Alliance": ["United", "Air Canada", "Lufthansa", "Singapore", "ANA", "Turkish"],
    "Oneworld": ["American", "British Airways", "Qatar", "Cathay Pacific", "Qantas"],
    "SkyTeam": ["Delta", "Air France", "Flying Blue", "KLM", "Korean Air"],
    "Unaligned": ["Alaska", "Emirates", "JetBlue"],
  };
  return (map[alliance] || []).some((n) => programName.toLowerCase().includes(n.toLowerCase()));
}

function programBalancesFromInputs(inputs) {
  return inputs.programBalances || [];
}

/* ---------- main entry point ---------- */

function runOptimization(inputs, liveOffers) {
  const usingLive = Array.isArray(liveOffers) && liveOffers.length > 0;
  const candidates = usingLive ? buildLiveCandidates(inputs, liveOffers) : generateCandidates(inputs);
  if (!candidates.length) return runOptimization(inputs); // e.g. every live offer was on an avoided airline
  const weights = computeWeights(inputs.priorityRanks);
  candidates.forEach((c) => (c.weighted = weightedScore(c.scores, weights)));
  candidates.sort((a, b) => b.weighted - a.weighted);
  const best = candidates[0];
  const alternatives = candidates.slice(0, 5);
  const timing = purchaseTiming(inputs);
  const award = awardRecommendation(best, inputs, inputs.programBalances || []);
  const insights = buildInsights(inputs, candidates, best, weights, timing, usingLive);
  const tactics = upgradeTactics(best, inputs);
  const pointsIntel = bestPointsAnswers(inputs);
  return { candidates, weights, best, alternatives, timing, award, insights, tactics, pointsIntel, usingLive };
}

if (typeof window !== "undefined") {
  window.TravelIntel = {
    runOptimization, computeWeights, upgradeTactics, bestPointsAnswers, toIATA, carrierSite, suggestPriorities,
    ALLIANCES, ALL_CARRIERS, TRANSFER_PARTNERS, POINT_VALUATIONS, TRANSFER_BONUSES,
    DIMENSIONS, DIM_LABEL, fmtUSD,
    // exposed 2026-07-20 for tests/app.test.js — these were already pure,
    // just not on the public surface (nothing here is DOM-touching).
    awardRecommendation, buildLiveCandidates, ASIA_COMFORT_BONUS, ASIAN_CARRIERS,
    // exposed 2026-07-21 for tests/app.test.js — saved preferences & trip
    // memory (phase 07's fuller slice, after the wallet).
    travelStyleFallback, flagsDislikedAirport, matchUpgradeWinCarrier,
  };
}
