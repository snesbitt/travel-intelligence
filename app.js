/* Travel Intelligence — optimization engine
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

    // miles+cash either/or: an estimated miles price for THIS candidate,
    // interpolated within the cabin's reference range by where the cash
    // price sits in its own plausible band. Planning figure, not a quote.
    const priceBand = clamp((price - (CABIN_FLOOR[inputs.cabin] || 200)) / Math.max(1, (CABIN_BASE[inputs.cabin] || 620) * 1.4), 0, 1);
    const milesEst = Math.round((range.milesLow + (range.milesHigh - range.milesLow) * priceBand) / 5000) * 5000;
    const feesEst = Math.round(range.feesLow + (range.feesHigh - range.feesLow) * priceBand);
    const candCpp = ((price - feesEst) / Math.max(1, milesEst)) * 100;

    candidates.push({
      id: i, carrier, alliance: allianceOf(carrier), stops, fareTier, price, dateOffset,
      cabin: inputs.cabin === "Best Value" ? (cpp * 42 > 60 ? "Business" : "Economy") : inputs.cabin,
      scores, cpp, milesMid, feesMid,
      milesEst, feesEst, candCpp, payWith: candCpp >= 1.6 ? "miles" : "cash",
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

/* ---------- upgrade tactics ----------
 * Concrete, ordered plays to land the cabin you actually want — the
 * "do this creative thing to get what you want" layer. Grounded in the
 * bid-upgrade mechanics documented by TPG and Going (July 2026): bid
 * 20–40% of the fare gap, slightly above the minimum; most bid windows
 * close 48–72h out (Virgin Atlantic opens 7 days out); typical winning
 * long-haul business bids run $300–600; if the bid loses, ask at
 * check-in — counter-offers there are common.
 */

function upgradeTactics(best, inputs) {
  const tactics = [];
  const cabinAbove = { Economy: "Premium Economy", "Premium Economy": "Business", Business: "First", "Best Value": "Business" }[best.cabin];
  if (!cabinAbove) {
    tactics.push({ title: "You're booking top cabin", detail: "No upgrade path above First — the play here is price, not position. Consider whether Business at roughly half the fare gets you 90% of the experience." });
    return tactics;
  }

  tactics.push({
    title: `Book the upgradeable fare, not the cheapest one`,
    detail: `Basic/deep-discount buckets are usually excluded from upgrades entirely. On ${best.carrier}, book at least the Standard fare tier — the few dollars more is the entry ticket to every tactic below.`,
  });
  tactics.push({
    title: `Bid 20–40% of the fare gap — slightly above the minimum`,
    detail: `If ${cabinAbove} sells for say $2,400 more than your fare, a winning bid typically lands at $480–960. Most travelers bid the exact minimum, so bidding even 5–10% above it beats the crowd. Typical winning long-haul Business bids run $300–600. Bids are per segment, per passenger, and charge only if you win.`,
  });
  tactics.push({
    title: `Know the bid window and set a reminder`,
    detail: `Most carriers open upgrade bidding after booking and close it 48–72 hours before departure (Virgin Atlantic opens a full 7 days out; a few award winners as late as 3 hours before). Set a calendar reminder for T-minus-4-days to place or revise your bid.`,
  });
  tactics.push({
    title: `Check the premium cabin seat map before bidding`,
    detail: `A wide-open ${cabinAbove} cabin a week out means low bids clear; a nearly-full one means don't waste the bid. Check the seat map on ${best.carrier}'s own site (or ExpertFlyer) the day bidding closes.`,
  });
  tactics.push({
    title: `Miles + cash copay upgrade`,
    detail: `Many programs sell one-cabin upgrades for miles plus a cash copay — often the single best redemption rate in the whole program, and a smart use of a balance too small for a full award. Call or check "upgrade with miles" on your booking before paying a cash bid.`,
  });
  tactics.push({
    title: `If the bid loses, ask at check-in — then again at the gate`,
    detail: `Rejected bids are routinely followed by a cheaper counter-offer at online check-in (T-24h). Failing that, ask the agent at the desk, politely and specifically: "Are paid upgrades to ${cabinAbove} available on this flight?" Gate offers on undersold cabins can beat every earlier price.`,
  });
  if (inputs.tripPurpose === "Business" || inputs.tripPurpose === "Family") {
    tactics.push({
      title: `The creative play: split the cabin`,
      detail: `Booking one ${cabinAbove} seat and the rest of the party in ${best.cabin} — then trading off on a long flight — costs a fraction of upgrading everyone and is entirely allowed.`,
    });
  }
  tactics.push({
    title: `The creative play: price the "mistake" routings`,
    detail: `Same-cabin fares from a nearby origin (${(inputs.airportFlexibility || "your alternates").split(",")[0].trim()} vs. a bigger hub) or with one positioning flight are sometimes lower than the upgrade cost itself — always price ${cabinAbove} from the alternate airports you listed before paying to upgrade the primary routing.`,
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
  const tactics = upgradeTactics(best, inputs);
  const pointsIntel = bestPointsAnswers(inputs);
  return { candidates, weights, best, alternatives, timing, award, insights, tactics, pointsIntel };
}

if (typeof window !== "undefined") {
  window.TravelIntel = {
    runOptimization, computeWeights, upgradeTactics, bestPointsAnswers,
    ALLIANCES, ALL_CARRIERS, TRANSFER_PARTNERS, POINT_VALUATIONS, TRANSFER_BONUSES,
    DIMENSIONS, DIM_LABEL, fmtUSD,
  };
}
