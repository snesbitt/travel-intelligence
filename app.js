/* Travel Scout — optimization engine
 * Pure, deterministic, client-side. No live fare or award data yet (see
 * roadmap.html Phase 2) — this models the same scoring/weighting framework
 * real data will plug into later, using hand-maintained reference ranges
 * instead of a live search. Every number the engine shows is either
 * computed from your inputs or labeled as a typical/reference range —
 * nothing here is presented as a live quote. See guide.html, step 03.
 */

/* ---------- reference data (hand-maintained, not live-fetched) ---------- */

const ALLIANCES = {
  "Star Alliance": ["United", "Air Canada", "Lufthansa", "Singapore Airlines", "ANA", "Turkish Airlines"],
  "Oneworld": ["American", "British Airways", "Qatar Airways", "Cathay Pacific", "Qantas"],
  "SkyTeam": ["Delta", "Air France", "KLM", "Korean Air"],
  "Unaligned": ["Alaska Airlines", "Emirates", "JetBlue"],
};

const ALL_CARRIERS = Object.values(ALLIANCES).flat();

// General reputation for complimentary/mileage upgrade generosity, 0-100.
// This is a hand-maintained editorial judgment, not a live seat-map read —
// see about.html for how this differs from a real inventory check.
const UPGRADE_FRIENDLY = {
  United: 78, "Air Canada": 63, Lufthansa: 52, "Singapore Airlines": 38, ANA: 44, "Turkish Airlines": 58,
  American: 74, "British Airways": 48, "Qatar Airways": 33, "Cathay Pacific": 43, Qantas: 54,
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
  "American Express Membership Rewards": { ratio: "1:1", note: "transfers to most Star Alliance and Oneworld programs, plus Delta" },
  "Chase Ultimate Rewards": { ratio: "1:1", note: "transfers to United, Air France/KLM, Virgin Atlantic — no American or Delta" },
  "Capital One": { ratio: "1:1 (most partners)", note: "transfers to Air Canada, Turkish, Avianca LifeMiles, Air France/KLM" },
  "Citi ThankYou": { ratio: "1:1 (most partners)", note: "transfers to Turkish, Air France/KLM" },
  "Bilt Rewards": { ratio: "1:1", note: "transfers to United, American, Air France/KLM, Turkish — the only major card that transfers to American" },
  "Wells Fargo": { ratio: "1:1", note: "transfers to Air France/KLM, Avianca LifeMiles" },
  "Marriott Bonvoy": { ratio: "3:1 (plus a 5,000 bonus per 60k converted)", note: "weak ratio for flights — hotel points converted to air are rarely a good redemption" },
};

const PRIORITY_WEIGHTS = {
  Cheapest:                 { Cost: 1.0, Comfort: 0.1, Upgrade: 0.1, Award: 0.2, Flexibility: 0.1, Risk: 0.2 },
  "Best Value":              { Cost: 0.6, Comfort: 0.4, Upgrade: 0.2, Award: 0.3, Flexibility: 0.3, Risk: 0.3 },
  Fastest:                   { Cost: 0.1, Comfort: 0.3, Upgrade: 0.1, Award: 0.0, Flexibility: 0.1, Risk: 0.7 },
  "Most Comfortable":        { Cost: 0.1, Comfort: 1.0, Upgrade: 0.2, Award: 0.1, Flexibility: 0.2, Risk: 0.2 },
  "Best Upgrade Opportunity": { Cost: 0.1, Comfort: 0.3, Upgrade: 1.0, Award: 0.1, Flexibility: 0.1, Risk: 0.1 },
  "Best Use of Miles":        { Cost: 0.1, Comfort: 0.1, Upgrade: 0.2, Award: 1.0, Flexibility: 0.1, Risk: 0.1 },
  "Best Overall Experience":  { Cost: 0.3, Comfort: 0.5, Upgrade: 0.4, Award: 0.3, Flexibility: 0.3, Risk: 0.3 },
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

function generateCandidates(inputs) {
  const seedStr = [inputs.origin, inputs.destination, inputs.departDate, inputs.returnDate, inputs.cabin, inputs.maxBudget].join("|");
  const rng = mulberry32(hashSeed(seedStr));
  const pool = candidatePool(inputs);
  const flexDays = { Exact: 0, "±1 day": 1, "±3 days": 3, "±7 days": 7 }[inputs.dateFlexibility] || 0;

  const fareTiers = ["Basic", "Standard", "Flexible"];
  const candidates = [];
  const n = Math.max(5, Math.min(7, pool.length + 2));

  for (let i = 0; i < n; i++) {
    const carrier = pool[i % pool.length];
    const stopsRoll = rng();
    const stops = inputs.maxStops <= 0 ? 0 : Math.min(inputs.maxStops, Math.floor(stopsRoll * (inputs.maxStops + 1)));
    const fareTier = fareTiers[clamp(Math.floor(rng() * fareTiers.length) + (inputs.cabin === "Business" || inputs.cabin === "First" ? 1 : 0), 0, 2)];
    const dateOffset = flexDays ? Math.round((rng() * 2 - 1) * flexDays) : 0;

    // price model: per-cabin round-trip base, seeded noise, stops discount,
    // fare-tier adjustment, then a per-cabin floor. Planning model, not a
    // fetched fare — see the eyebrow banner on this page.
    let base = CABIN_BASE[inputs.cabin] || CABIN_BASE.Economy;
    base *= 1 + (0.5 - rng()) * 0.5; // +/-25% noise
    base -= stops * (CABIN_STOP_DISCOUNT[inputs.cabin] || 30);
    base *= fareTier === "Basic" ? 0.82 : fareTier === "Flexible" ? 1.18 : 1;
    if (dateOffset !== 0) base *= 1 - Math.min(0.12, Math.abs(dateOffset) * 0.02);
    const price = Math.max(CABIN_FLOOR[inputs.cabin] || 200, Math.round(base));

    const scores = {};
    scores.Cost = clamp(100 - (price / Math.max(1, inputs.maxBudget)) * 65, 4, 100);
    scores.Comfort = clamp((CABIN_COMFORT_BASE[inputs.cabin] || 50) - stops * 11 + (stops === 0 ? 6 : 0), 5, 100);
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

    candidates.push({
      id: i, carrier, alliance: allianceOf(carrier), stops, fareTier, price, dateOffset,
      cabin: inputs.cabin === "Best Value" ? (cpp * 42 > 60 ? "Business" : "Economy") : inputs.cabin,
      scores, cpp, milesMid, feesMid,
      travelMinutes: 105 + stops * 95 + Math.round(rng() * 40),
      aircraft: pickAircraft(rng, stops, inputs.cabin),
    });
  }
  return candidates;
}

function pickAircraft(rng, stops, cabin) {
  const wide = ["Boeing 787-9", "Airbus A350-900", "Boeing 777-300ER", "Airbus A330-300"];
  const narrow = ["Airbus A321neo", "Boeing 737 MAX 9", "Airbus A320"];
  // First class only flies on widebody aircraft in practice; nonstops skew
  // widebody too, since a single-connection narrowbody hop is the more
  // typical use of a narrowbody in this model.
  const wideChance = cabin === "First" ? 1 : stops === 0 ? 0.72 : 0.15;
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
  const cpp = ((best.price - feesMid) / milesMid) * 100;
  const alliance = best.alliance;
  const relevantPrograms = programBalances.filter((p) => p.balance > 0);
  const strong = cpp >= 1.6;
  return { milesLow: range.milesLow, milesHigh: range.milesHigh, milesMid, feesMid, cpp, strong, alliance, relevantPrograms, cabin: best.cabin };
}

/* ---------- insights ---------- */

function buildInsights(inputs, candidates, best, weights, timing) {
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

  if (timing.verdict === "wait") {
    insights.push(`Purchase timing leans "wait, don't book yet" — ${timing.reason.toLowerCase()} Set a fare alert instead of checking manually.`);
  }
  if (timing.verdict === "buy") {
    insights.push(`Purchase timing leans "buy now" — ${timing.reason.toLowerCase()}`);
  }

  if (best.stops >= 1 && candidates.every((c) => c.stops >= 1) === false) {
    // already covered above; skip duplicate
  }

  if (inputs.airportFlexibility && inputs.airportFlexibility.split(",").map((s) => s.trim()).filter(Boolean).length > 1) {
    insights.push(`You've listed more than one workable departure airport. Once live fare data is wired in (see roadmap.html), this is exactly the kind of input that tends to surface the largest single savings — nearby-airport comparisons routinely beat date-shifting alone.`);
  }

  insights.push(`This shortlist is scored, not searched — treat the price and mileage figures as planning ranges from a documented model, not a live quote. See guide.html for exactly what's computed vs. what's a hand-maintained reference range.`);

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

function runOptimization(inputs) {
  const candidates = generateCandidates(inputs);
  const weights = computeWeights(inputs.priorityRanks);
  candidates.forEach((c) => (c.weighted = weightedScore(c.scores, weights)));
  candidates.sort((a, b) => b.weighted - a.weighted);
  const best = candidates[0];
  const alternatives = candidates.slice(0, 5);
  const timing = purchaseTiming(inputs);
  const award = awardRecommendation(best, inputs, inputs.programBalances || []);
  const insights = buildInsights(inputs, candidates, best, weights, timing);
  return { candidates, weights, best, alternatives, timing, award, insights };
}

if (typeof window !== "undefined") {
  window.TravelScout = { runOptimization, computeWeights, ALLIANCES, ALL_CARRIERS, TRANSFER_PARTNERS, DIMENSIONS, DIM_LABEL, fmtUSD };
}
