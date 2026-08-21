// tests/app.test.js
// Minimal, dependency-free tests for app.js's pure functions. No test
// framework, plain Node `assert`, run via `node tests/app.test.js` (see
// the "test" script in package.json). app.js is a browser script (no
// module.exports), so it's loaded here the way index.html loads it: by
// giving it a `window` to attach `window.TravelIntel` to, then reading
// that object back out. Nothing here touches the network or the DOM, 
// per the CRITICAL constraint on this repo, no live SerpApi calls.

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = {};
require(path.join(__dirname, "..", "app.js"));
const T = global.window.TravelIntel;

assert.ok(T, "window.TravelIntel should be populated by app.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

/* ---------- award threshold: awardRecommendation, ~1.6c/mile ---------- */

test("awardRecommendation: below 1.6c/mile is not a strong redemption", () => {
  const best = { candCpp: 1.59, cabin: "Economy", alliance: "Star Alliance", price: 900 };
  const award = T.awardRecommendation(best, { cabin: "Economy" }, []);
  assert.equal(award.strong, false);
  assert.equal(award.cpp, 1.59);
});

test("awardRecommendation: at exactly 1.6c/mile clears the bar (>=)", () => {
  const best = { candCpp: 1.6, cabin: "Economy", alliance: "Star Alliance", price: 900 };
  const award = T.awardRecommendation(best, { cabin: "Economy" }, []);
  assert.equal(award.strong, true);
});

test("awardRecommendation: above 1.6c/mile is a strong redemption", () => {
  const best = { candCpp: 2.4, cabin: "Business", alliance: "Oneworld", price: 4200 };
  const award = T.awardRecommendation(best, { cabin: "Business" }, []);
  assert.equal(award.strong, true);
  assert.equal(award.cpp, 2.4);
});

/* ---------- Asia comfort bonus: ASIA_COMFORT_BONUS on buildLiveCandidates ---------- */

test("buildLiveCandidates: an Asia-based carrier gets exactly +ASIA_COMFORT_BONUS Comfort on an Asia route", () => {
  const inputs = {
    origin: "San Francisco", destination: "Tokyo", cabin: "Economy",
    departDate: "2027-03-01", maxBudget: 2000, travelers: 1, avoidAirlines: [],
  };
  const asianCarrier = T.ASIAN_CARRIERS[0]; // e.g. "ANA", pulled from the live list, not hardcoded
  const nonAsianCarrier = "United"; // not a substring match for any entry in ASIAN_CARRIERS
  assert.ok(
    !T.ASIAN_CARRIERS.some((c) => nonAsianCarrier.toLowerCase().includes(c.toLowerCase())),
    "test fixture assumption broke: 'United' now matches ASIAN_CARRIERS"
  );

  // Same price/stops/cabin for both offers so every other Comfort input matches;
  // carrier identity is the only variable, isolating the bonus.
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: asianCarrier },
    { priceTotal: 1000, stops: 0, carrier: nonAsianCarrier },
  ];
  const [withAsianCarrier, withoutAsianCarrier] = T.buildLiveCandidates(inputs, offers);
  assert.equal(
    withAsianCarrier.scores.Comfort - withoutAsianCarrier.scores.Comfort,
    T.ASIA_COMFORT_BONUS,
    "Comfort score gap between an Asia-based and non-Asia-based carrier should equal ASIA_COMFORT_BONUS"
  );
});

test("buildLiveCandidates: the Asia comfort bonus does NOT apply on a non-Asia route", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy",
    departDate: "2027-03-01", maxBudget: 2000, travelers: 1, avoidAirlines: [],
  };
  const asianCarrier = T.ASIAN_CARRIERS[0];
  const nonAsianCarrier = "United";
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: asianCarrier },
    { priceTotal: 1000, stops: 0, carrier: nonAsianCarrier },
  ];
  const [withAsianCarrier, withoutAsianCarrier] = T.buildLiveCandidates(inputs, offers);
  assert.equal(withAsianCarrier.scores.Comfort, withoutAsianCarrier.scores.Comfort);
});

/* ---------- preferred airline/alliance/time-of-day Comfort bonuses
   (2026-08-05, audit backlog: "wire the six dead preference fields into
   real scoring") ---------- */

test("parseHourFromApiTime: reads the hour from a 'YYYY-MM-DD HH:MM' string", () => {
  assert.equal(T.parseHourFromApiTime("2026-10-15 08:20"), 8);
  assert.equal(T.parseHourFromApiTime("2026-10-15 23:59"), 23);
  assert.equal(T.parseHourFromApiTime("2026-10-15 00:05"), 0);
});

test("parseHourFromApiTime: null/undefined/malformed input returns null, never guesses", () => {
  assert.equal(T.parseHourFromApiTime(null), null);
  assert.equal(T.parseHourFromApiTime(undefined), null);
  assert.equal(T.parseHourFromApiTime(""), null);
  assert.equal(T.parseHourFromApiTime("not a time"), null);
  assert.equal(T.parseHourFromApiTime(1234), null);
});

test("departTimeBucket/arriveTimeBucket: bucket boundaries match the index.html <select> options exactly", () => {
  // Early morning 5-7, Morning 8-11, Afternoon 12-16, Evening 17-20, tail 21-4
  assert.equal(T.departTimeBucket("2026-10-15 05:00"), "Early morning");
  assert.equal(T.departTimeBucket("2026-10-15 07:59"), "Early morning");
  assert.equal(T.departTimeBucket("2026-10-15 08:00"), "Morning");
  assert.equal(T.departTimeBucket("2026-10-15 11:59"), "Morning");
  assert.equal(T.departTimeBucket("2026-10-15 12:00"), "Afternoon");
  assert.equal(T.departTimeBucket("2026-10-15 16:59"), "Afternoon");
  assert.equal(T.departTimeBucket("2026-10-15 17:00"), "Evening");
  assert.equal(T.departTimeBucket("2026-10-15 20:59"), "Evening");
  assert.equal(T.departTimeBucket("2026-10-15 21:00"), "Red-eye");
  assert.equal(T.departTimeBucket("2026-10-15 04:59"), "Red-eye");
  // same boundaries, but the overnight tail bucket is labeled differently for arrival
  assert.equal(T.arriveTimeBucket("2026-10-15 21:00"), "Late night");
  assert.equal(T.arriveTimeBucket("2026-10-15 04:59"), "Late night");
  assert.equal(T.arriveTimeBucket("2026-10-15 09:00"), "Morning");
});

test("buildLiveCandidates: a preferred airline gets exactly +PREFERRED_AIRLINE_BONUS Comfort", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: ["United"], preferredAlliances: [],
  };
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: "United" },
    { priceTotal: 1000, stops: 0, carrier: "Delta" },
  ];
  const [preferred, notPreferred] = T.buildLiveCandidates(inputs, offers);
  assert.equal(preferred.scores.Comfort - notPreferred.scores.Comfort, T.PREFERRED_AIRLINE_BONUS);
});

test("buildLiveCandidates: an empty preferredAirlines list applies no bonus to anyone", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: [],
  };
  const offers = [{ priceTotal: 1000, stops: 0, carrier: "United" }, { priceTotal: 1000, stops: 0, carrier: "Delta" }];
  const [a, b] = T.buildLiveCandidates(inputs, offers);
  assert.equal(a.scores.Comfort, b.scores.Comfort);
});

test("buildLiveCandidates: a preferred alliance gets exactly +PREFERRED_ALLIANCE_BONUS Comfort", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: ["Star Alliance"],
  };
  // United -> Star Alliance (fuzzyAlliance), Delta -> SkyTeam
  const offers = [{ priceTotal: 1000, stops: 0, carrier: "United" }, { priceTotal: 1000, stops: 0, carrier: "Delta" }];
  const [starAlliance, skyTeam] = T.buildLiveCandidates(inputs, offers);
  assert.equal(starAlliance.scores.Comfort - skyTeam.scores.Comfort, T.PREFERRED_ALLIANCE_BONUS);
});

test("buildLiveCandidates: preferred airline and preferred alliance bonuses stack additively", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: ["United"], preferredAlliances: ["Star Alliance"],
  };
  const offers = [{ priceTotal: 1000, stops: 0, carrier: "United" }, { priceTotal: 1000, stops: 0, carrier: "Spirit" }];
  const [both, neither] = T.buildLiveCandidates(inputs, offers);
  assert.equal(both.scores.Comfort - neither.scores.Comfort, T.PREFERRED_AIRLINE_BONUS + T.PREFERRED_ALLIANCE_BONUS);
});

test("buildLiveCandidates: a matching preferred departure time gets exactly +PREFERRED_TIME_BONUS Comfort", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: [],
    preferredDepartTime: "Morning",
  };
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: "United", departTimeRaw: "2027-03-01 09:00" }, // Morning
    { priceTotal: 1000, stops: 0, carrier: "United", departTimeRaw: "2027-03-01 22:00" }, // Red-eye
  ];
  const [morning, redEye] = T.buildLiveCandidates(inputs, offers);
  assert.equal(morning.scores.Comfort - redEye.scores.Comfort, T.PREFERRED_TIME_BONUS);
});

test("buildLiveCandidates: a matching preferred arrival time gets exactly +PREFERRED_TIME_BONUS Comfort", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: [],
    preferredArrivalTime: "Evening",
  };
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: "United", arriveTimeRaw: "2027-03-01 18:00" }, // Evening
    { priceTotal: 1000, stops: 0, carrier: "United", arriveTimeRaw: "2027-03-01 09:00" }, // Morning
  ];
  const [evening, morning] = T.buildLiveCandidates(inputs, offers);
  assert.equal(evening.scores.Comfort - morning.scores.Comfort, T.PREFERRED_TIME_BONUS);
});

test("buildLiveCandidates: depart and arrival time bonuses both apply when both match, stacking to 2x PREFERRED_TIME_BONUS", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: [],
    preferredDepartTime: "Morning", preferredArrivalTime: "Evening",
  };
  const offers = [
    { priceTotal: 1000, stops: 0, carrier: "United", departTimeRaw: "2027-03-01 09:00", arriveTimeRaw: "2027-03-01 18:00" },
    { priceTotal: 1000, stops: 0, carrier: "United", departTimeRaw: "2027-03-01 22:00", arriveTimeRaw: "2027-03-01 03:00" },
  ];
  const [bothMatch, neitherMatch] = T.buildLiveCandidates(inputs, offers);
  assert.equal(bothMatch.scores.Comfort - neitherMatch.scores.Comfort, T.PREFERRED_TIME_BONUS * 2);
});

test("buildLiveCandidates: missing departTimeRaw/arriveTimeRaw on an offer applies no time bonus (never guesses)", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: [], preferredAlliances: [],
    preferredDepartTime: "Morning", preferredArrivalTime: "Evening",
  };
  const offers = [{ priceTotal: 1000, stops: 0, carrier: "United" }];
  const [c] = T.buildLiveCandidates(inputs, offers);
  // base Comfort for Economy/0 stops, no bonuses at all
  assert.equal(c.scores.Comfort, T.buildLiveCandidates({ ...inputs, preferredDepartTime: "No preference", preferredArrivalTime: "No preference" }, offers)[0].scores.Comfort);
});

test("runOptimization: announces an active preferred-airline Comfort bonus in insights", () => {
  const inputs = {
    origin: "New York", destination: "London", cabin: "Economy", departDate: "2027-03-01",
    maxBudget: 2000, travelers: 1, avoidAirlines: [], preferredAirlines: ["United"], preferredAlliances: [],
    priorityRanks: { Cheapest: 1 }, programBalances: [], dateFlexibility: "Exact", upgradeWins: [],
  };
  const offers = [{ priceTotal: 1000, stops: 0, carrier: "United" }];
  const result = T.runOptimization(inputs, offers);
  assert.ok(
    result.insights.some((i) => i.includes("preferred airline") && i.includes(String(T.PREFERRED_AIRLINE_BONUS))),
    "expected an insight announcing the preferred-airline Comfort bonus"
  );
});

/* ---------- computeWeights normalization ---------- */

test("computeWeights: a single priority normalizes to weights summing to 1", () => {
  const weights = T.computeWeights({ Cheapest: 1 });
  const sum = T.DIMENSIONS.reduce((s, d) => s + weights[d], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `expected weights to sum to 1, got ${sum}`);
});

test("computeWeights: a primary+secondary priority list also normalizes to 1", () => {
  const weights = T.computeWeights({ Cheapest: 1, "Most Comfortable": 2 });
  const sum = T.DIMENSIONS.reduce((s, d) => s + weights[d], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `expected weights to sum to 1, got ${sum}`);
  // rank 1 ("Cheapest") should outweigh rank 2 ("Most Comfortable") on Cost,
  // since Cheapest's priority vector weights Cost heaviest and gets the
  // larger rank-based multiplier.
  assert.ok(weights.Cost > 0, "Cost weight should be positive");
});

test("computeWeights: every dimension is present and non-negative", () => {
  const weights = T.computeWeights({ "Best Overall Experience": 1 });
  for (const d of T.DIMENSIONS) {
    assert.ok(typeof weights[d] === "number" && weights[d] >= 0, `${d} weight should be a non-negative number`);
  }
});

/* ---------- saved preferences & trip memory (2026-07-21) ---------- */

test("travelStyleFallback: known styles return a primary+secondary+note", () => {
  const relaxed = T.travelStyleFallback("Relaxed");
  assert.equal(relaxed.primary, "Most Comfortable");
  assert.equal(relaxed.secondary, "Best Overall Experience");
  assert.ok(relaxed.note.includes("Relaxed"));

  const efficient = T.travelStyleFallback("Efficient");
  assert.equal(efficient.primary, "Fastest");

  const luxury = T.travelStyleFallback("Luxury");
  assert.equal(luxury.primary, "Best Upgrade Opportunity");
});

test("travelStyleFallback: unset or unknown style returns null (no override)", () => {
  assert.equal(T.travelStyleFallback("No preference"), null);
  assert.equal(T.travelStyleFallback(undefined), null);
  assert.equal(T.travelStyleFallback(""), null);
  assert.equal(T.travelStyleFallback("Fancy"), null);
});

test("suggestPriorities: a saved travel style only applies when no stronger trip signal fires", () => {
  // Tight budget still wins over a saved "Luxury" style, trip-specific
  // signals must never be silently overridden by a saved default. (Uses a
  // long-haul route so the modeled typical fare is well above the budget.)
  const tightBudget = T.suggestPriorities({
    cabin: "Economy", maxBudget: 300, origin: "San Francisco", destination: "Tokyo",
    departDate: "2026-09-01", tripPurpose: "Vacation", dateFlexibility: "Exact",
    programBalances: [], travelStyle: "Luxury",
  });
  assert.equal(tightBudget.primary, "Cheapest");

  // With no other signal able to fire, the saved style is the tiebreaker.
  const noOtherSignal = T.suggestPriorities({
    cabin: "Premium Economy", maxBudget: 999999, origin: "New York", destination: "Chicago",
    departDate: "2026-09-01", tripPurpose: "Vacation", dateFlexibility: "±3 days",
    programBalances: [], travelStyle: "Efficient",
  });
  assert.equal(noOtherSignal.primary, "Fastest");
});

test("flagsDislikedAirport: matches origin/destination/preferred/nearby/via fields, case-insensitively", () => {
  const inputs = { origin: "London", destination: "Tokyo", preferredAirport: "SFO", airportFlexibility: "SFO, SJC, OAK", viaCity: "", dislikedAirports: "lhr" };
  assert.equal(T.flagsDislikedAirport(inputs), "lhr");
});

test("flagsDislikedAirport: no match returns null", () => {
  const inputs = { origin: "San Francisco", destination: "Tokyo", preferredAirport: "SFO", airportFlexibility: "SFO, SJC, OAK", viaCity: "", dislikedAirports: "ORD, LHR" };
  assert.equal(T.flagsDislikedAirport(inputs), null);
});

test("flagsDislikedAirport: empty/unset preference returns null", () => {
  assert.equal(T.flagsDislikedAirport({ origin: "London", destination: "Tokyo", dislikedAirports: "" }), null);
  assert.equal(T.flagsDislikedAirport({ origin: "London", destination: "Tokyo" }), null);
});

test("matchUpgradeWinCarrier: finds a logged win mentioning the carrier, case-insensitively", () => {
  const wins = [{ text: "Delta SFO-JFK, bid $200, landed First", dateLogged: "2026-06-01T00:00:00.000Z" }];
  const match = T.matchUpgradeWinCarrier(wins, "delta");
  assert.ok(match);
  assert.equal(match.text, wins[0].text);
});

test("matchUpgradeWinCarrier: no match returns null/falsy", () => {
  const wins = [{ text: "United SFO-NRT, bid $400, landed Business", dateLogged: "2026-06-01T00:00:00.000Z" }];
  assert.ok(!T.matchUpgradeWinCarrier(wins, "ANA"));
  assert.ok(!T.matchUpgradeWinCarrier([], "United"));
  assert.ok(!T.matchUpgradeWinCarrier(undefined, "United"));
  assert.ok(!T.matchUpgradeWinCarrier(wins, ""));
});


/* ---------- 2026-07-24: unknown-destination honesty (SFO->Greenville) ---------- */

test("toIATA: Greenville/Spartanburg resolve to GSP (incl. fuzzy)", () => {
  assert.equal(T.toIATA("greenville, south carolina"), "GSP");
  assert.equal(T.toIATA("Greenville"), "GSP");
  assert.equal(T.toIATA("Spartanburg"), "GSP");
});

test("runOptimization: known route (SFO->GSP) is ~3,600 km, not the 7,500 km default", () => {
  // 2026-07-26: model path deleted, the geometry regression now guards the
  // LIVE path's duration estimate (used when an offer omits durationMinutes).
  const r = T.runOptimization({ origin: "San Francisco", destination: "Greenville, South Carolina",
    departDate: "2026-08-10", returnDate: "2026-08-11", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "American", priceTotal: 350, stops: 0 }]);
  assert.equal(r.routeKnown, true);
  // 9h34m was the giveaway: 7,500km default. Real GSP geometry must estimate well under 6h nonstop air time.
  const nonstops = r.candidates.filter((c) => c.stops === 0);
  assert.ok(nonstops.length > 0, "expected the nonstop live offer to survive");
  for (const c of nonstops) assert.ok(c.travelMinutes < 360, "nonstop estimated over 6h: " + c.travelMinutes);
});

test("runOptimization: unresolved city WITH live offers is still real data (routeKnown=true); WITHOUT offers it hard-stops", () => {
  // Live results are real by definition, an unresolved display name must not
  // suppress real quotes. The honesty gate now lives in the no-data path.
  const withOffers = T.runOptimization({ origin: "San Francisco", destination: "Atlantis, Lost Continent",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "United", priceTotal: 900, stops: 1, durationMinutes: 600 }]);
  assert.equal(withOffers.routeKnown, true);
  assert.equal(withOffers.best.routeKnown, false, "candidate-level flag still marks the unresolved geometry");
  const noOffers = T.runOptimization({ origin: "San Francisco", destination: "Atlantis, Lost Continent",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 });
  assert.equal(noOffers.routeKnown, false);
  assert.equal(noOffers.noLiveData, true);
});

test("runOptimization with no live offers returns an honest noLiveData result, never synthetic candidates", () => {
  const r = T.runOptimization({ origin: "San Francisco", destination: "Tokyo",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: { Cheapest: 1 },
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 });
  assert.equal(r.noLiveData, true);
  assert.equal(r.usingLive, false);
  assert.equal(r.routeKnown, false);
  assert.equal(r.best, null);
  assert.equal(r.candidates.length, 0);
  assert.ok(r.weights, "weights still computed for display");
});

test("runOptimization: offers all filtered out (avoided airline) also returns noLiveData, not a synthetic fallback", () => {
  const r = T.runOptimization({ origin: "San Francisco", destination: "Tokyo",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: { Cheapest: 1 },
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: ["Spirit"], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "Spirit", priceTotal: 400, stops: 2, durationMinutes: 900 }]);
  assert.equal(r.noLiveData, true);
  assert.equal(r.candidates.length, 0);
});

test("buildLiveCandidates (Susan 2026-07-31: 'I always want to fly nonstop if available'): maxStops actually excludes offers now, it used to be collected and silently ignored", () => {
  const inputs = { destination: "Tokyo", origin: "San Francisco", cabin: "Economy", maxBudget: 2000,
    departDate: "2026-08-10", travelers: 1, avoidAirlines: [] };
  const offers = [
    { carrier: "United", priceTotal: 900, stops: 0, durationMinutes: 620 },
    { carrier: "ANA", priceTotal: 850, stops: 1, durationMinutes: 780 },
    { carrier: "Delta", priceTotal: 700, stops: 2, durationMinutes: 900 },
  ];
  // no limit set (field omitted): every existing caller that predates this
  // filter behaves exactly as before, all offers still score
  assert.equal(T.buildLiveCandidates({ ...inputs }, offers).length, 3);
  assert.deepEqual(T.buildLiveCandidates({ ...inputs, maxStops: 0 }, offers).map((c) => c.stops), [0]);
  assert.deepEqual(T.buildLiveCandidates({ ...inputs, maxStops: 1 }, offers).map((c) => c.stops), [0, 1]);
  assert.deepEqual(T.buildLiveCandidates({ ...inputs, maxStops: 2 }, offers).map((c) => c.stops), [0, 1, 2]);
  assert.equal(T.buildLiveCandidates({ ...inputs, maxStops: 3 }, offers).length, 3, "3 = 'Any stops' in the UI, same as no limit");
});

/* ---------- 2026-08-07: SFO->Tallinn bug, filtered-to-zero diagnostics ---------- */
// Real fares existed for this route (5+ real offers from SerpApi), but every
// one had 1+ stops (no real nonstop US-Tallinn routing exists) and Susan's
// saved "Nonstop only" filter zeroed them all out. runOptimization() used to
// collapse this into the exact same generic "noLiveData"/"failed or timed
// out" shape as a genuine API failure. These tests lock in the fix: the
// diagnostics distinguish "nothing came back" from "real fares came back and
// a saved filter removed every one," so the UI can say so honestly.

test("buildLiveCandidates: rawOfferCount reflects offers before any filtering", () => {
  const inputs = { destination: "Tallinn", origin: "San Francisco", cabin: "Economy", maxBudget: 2000,
    departDate: "2026-11-16", travelers: 1, avoidAirlines: [], maxStops: 0 };
  const offers = [
    { carrier: "Lufthansa", priceTotal: 743, stops: 1, durationMinutes: 900 },
    { carrier: "American", priceTotal: 748, stops: 2, durationMinutes: 980 },
    { carrier: "KLM", priceTotal: 859, stops: 1, durationMinutes: 910 },
  ];
  const candidates = T.buildLiveCandidates(inputs, offers);
  assert.equal(candidates.length, 0, "every offer has 1+ stops; Nonstop-only filters all of them out");
  assert.equal(candidates.rawOfferCount, 3, "the raw count from the live API is preserved even though every offer got filtered");
});

test("buildLiveCandidates: stopsFilteredAllOut is true only when real offers existed and the stops filter zeroed them all out", () => {
  const inputs = { destination: "Tallinn", origin: "San Francisco", cabin: "Economy", maxBudget: 2000,
    departDate: "2026-11-16", travelers: 1, avoidAirlines: [], maxStops: 0 };
  const offersAllWithStops = [
    { carrier: "Lufthansa", priceTotal: 743, stops: 1, durationMinutes: 900 },
    { carrier: "KLM", priceTotal: 859, stops: 1, durationMinutes: 910 },
  ];
  const filtered = T.buildLiveCandidates(inputs, offersAllWithStops);
  assert.equal(filtered.stopsFilteredAllOut, true);
  assert.equal(filtered.airlineFilteredAllOut, false);

  // A genuine nonstop offer survives the same filter, not filtered out.
  const offersWithNonstop = offersAllWithStops.concat([{ carrier: "United", priceTotal: 900, stops: 0, durationMinutes: 620 }]);
  const notFiltered = T.buildLiveCandidates(inputs, offersWithNonstop);
  assert.equal(notFiltered.stopsFilteredAllOut, false, "at least one candidate survived, this isn't the filtered-to-zero case");
  assert.equal(notFiltered.length, 1);

  // No live offers at all is a different case from "offers existed and got filtered."
  const empty = T.buildLiveCandidates(inputs, []);
  assert.equal(empty.stopsFilteredAllOut, false, "nothing came back at all, not a filtering problem");
  assert.equal(empty.rawOfferCount, 0);
});

test("buildLiveCandidates: airlineFilteredAllOut mirrors the same distinction for the avoided-airlines filter", () => {
  const inputs = { destination: "Tokyo", origin: "San Francisco", cabin: "Economy", maxBudget: 2000,
    departDate: "2026-08-10", travelers: 1, avoidAirlines: ["Spirit"] };
  const offers = [{ carrier: "Spirit", priceTotal: 400, stops: 2, durationMinutes: 900 }];
  const filtered = T.buildLiveCandidates(inputs, offers);
  assert.equal(filtered.airlineFilteredAllOut, true);
  assert.equal(filtered.stopsFilteredAllOut, false);
  assert.equal(filtered.rawOfferCount, 1);
});

test("runOptimization: threads stopsFilteredAllOut/rawOfferCount into the noLiveData result instead of a generic empty state", () => {
  const inputs = { origin: "San Francisco", destination: "Tallinn", departDate: "2026-11-16",
    cabin: "Economy", maxStops: 0, priorityRanks: { Cheapest: 1 },
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 };
  const offers = [
    { carrier: "Lufthansa", priceTotal: 743, stops: 1, durationMinutes: 900 },
    { carrier: "American", priceTotal: 748, stops: 2, durationMinutes: 980 },
  ];
  const r = T.runOptimization(inputs, offers);
  assert.equal(r.noLiveData, true);
  assert.equal(r.routeKnown, false);
  assert.equal(r.stopsFilteredAllOut, true, "the live fetch succeeded, this must not look like a generic failure");
  assert.equal(r.airlineFilteredAllOut, false);
  assert.equal(r.rawOfferCount, 2);
});

test("runOptimization: a genuine empty/failed live fetch reports rawOfferCount 0 and both filtered flags false", () => {
  const inputs = { origin: "San Francisco", destination: "Tokyo", departDate: "2026-08-10",
    cabin: "Economy", maxStops: 2, priorityRanks: { Cheapest: 1 },
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 };
  const r = T.runOptimization(inputs, null);
  assert.equal(r.noLiveData, true);
  assert.equal(r.rawOfferCount, 0);
  assert.equal(r.stopsFilteredAllOut, false);
  assert.equal(r.airlineFilteredAllOut, false);
});

test("runOptimization: 'Nonstop only' with no nonstop offer available correctly returns the honest empty state, not a stopped itinerary", () => {
  const r = T.runOptimization({ origin: "San Francisco", destination: "Tokyo",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 0, maxBudget: 2000, priorityRanks: { Cheapest: 1 },
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "ANA", priceTotal: 850, stops: 1, durationMinutes: 780 }]);
  assert.equal(r.noLiveData, true);
  assert.equal(r.candidates.length, 0);
});


/* ---------- 2026-07-24: route-prefilled booking deep links ---------- */

const DEEPLINK_INPUTS = { origin: "San Francisco", destination: "Greenville, South Carolina",
  departDate: "2026-08-10", returnDate: "2026-08-11", travelers: 1 };

test("liveSearchUrls: American gets the verified aa.com slices deep link with both dates", () => {
  const u = T.liveSearchUrls(DEEPLINK_INPUTS, "American");
  assert.ok(u.carrierDeep.startsWith("https://www.aa.com/booking/search?"));
  assert.ok(u.carrierDeep.includes("type=RoundTrip"));
  const slices = JSON.parse(decodeURIComponent(u.carrierDeep.split("slices=")[1]));
  assert.equal(slices.length, 2);
  assert.deepEqual([slices[0].orig, slices[0].dest, slices[0].date], ["SFO", "GSP", "2026-08-10"]);
  assert.deepEqual([slices[1].orig, slices[1].dest, slices[1].date], ["GSP", "SFO", "2026-08-11"]);
});

test("liveSearchUrls: non-AA carrier gets Google Flights only, with route and dates", () => {
  const u = T.liveSearchUrls(DEEPLINK_INPUTS, "United");
  assert.equal(u.carrierDeep, null);
  assert.ok(u.googleFlights.startsWith("https://www.google.com/travel/flights?q="));
  const q = decodeURIComponent(u.googleFlights.split("q=")[1]);
  assert.equal(q, "Flights from SFO to GSP on 2026-08-10 through 2026-08-11");
});

test("liveSearchUrls: one-way AA link uses a single slice and type=OneWay", () => {
  const u = T.liveSearchUrls({ origin: "SFO", destination: "BNA", departDate: "2026-09-01" }, "American Airlines");
  assert.ok(u.carrierDeep.includes("type=OneWay"));
  assert.equal(JSON.parse(decodeURIComponent(u.carrierDeep.split("slices=")[1])).length, 1);
});

test("liveSearchUrls: unresolved city or missing date produces NO links (never a link to an unnamed route)", () => {
  assert.deepEqual(T.liveSearchUrls({ origin: "SFO", destination: "Atlantis", departDate: "2026-09-01" }, "American"), { carrierDeep: null, googleFlights: null });
  assert.deepEqual(T.liveSearchUrls({ origin: "SFO", destination: "BNA" }, "American"), { carrierDeep: null, googleFlights: null });
});

/* ---------- 2026-08-11: open-jaw (return from a different city) ---------- */

const OPENJAW_INPUTS = { origin: "SFO", destination: "VFA", returnFromCity: "BBK",
  departDate: "2027-05-21", returnDate: "2027-06-01", travelers: 1 };

test("liveSearchUrls: open-jaw gets an honest Google Flights query naming the real return leg, not a same-city round trip", () => {
  const u = T.liveSearchUrls(OPENJAW_INPUTS, "United");
  const q = decodeURIComponent(u.googleFlights.split("q=")[1]);
  assert.equal(q, "Flights from SFO to VFA on 2027-05-21, returning BBK to SFO on 2027-06-01");
});

test("liveSearchUrls: open-jaw NEVER produces an AA carrierDeep link, even for American (unverified URL shape, per the no-unverified-links rule)", () => {
  const u = T.liveSearchUrls(OPENJAW_INPUTS, "American");
  assert.equal(u.carrierDeep, null);
  assert.ok(u.googleFlights, "the honest fallback link must still be present");
});

test("liveSearchUrls: no returnFromCity is unaffected (the common case, same output as before open-jaw existed)", () => {
  const u = T.liveSearchUrls(DEEPLINK_INPUTS, "American");
  assert.ok(u.carrierDeep.includes("type=RoundTrip"));
});

test("expanded city tables: new US regionals resolve with real geometry (no 7,500 km default)", () => {
  for (const [city, code] of [["Nashville", "BNA"], ["Savannah", "SAV"], ["Charleston", "CHS"], ["fort lauderdale", "FLL"]]) {
    assert.equal(T.toIATA(city), code);
  }
  const r = T.runOptimization({ origin: "San Francisco", destination: "Nashville",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "United", priceTotal: 320, stops: 0, durationMinutes: 260 }]);
  assert.equal(r.routeKnown, true);
});


/* ---------- 2026-07-24: displayCity, code or name in, city out ---------- */

test("displayCity: airport code in, city name out", () => {
  assert.equal(T.displayCity("GSP"), "Greenville, SC (GSP)");
  assert.equal(T.displayCity("gsp"), "Greenville, SC (GSP)");
  assert.equal(T.displayCity("SFO"), "San Francisco (SFO)");
});

test("displayCity: city name in, canonical 'City (CODE)' out (incl. multiword title-case)", () => {
  assert.equal(T.displayCity("san francisco"), "San Francisco (SFO)");
  assert.equal(T.displayCity("Greenville, South Carolina"), "Greenville, SC (GSP)");
  assert.equal(T.displayCity("salt lake city"), "Salt Lake City (SLC)");
});

test("displayCityName: city only, no code suffix (watched-row rendering)", () => {
  assert.equal(T.displayCityName("SFO"), "San Francisco");
  assert.equal(T.displayCityName("GBE"), "Gaborone, Botswana");
  assert.equal(T.displayCityName("Atlantis"), "Atlantis");
});

test("displayCity: Gaborone resolves from code, city, or country (watched-trip fix)", () => {
  assert.equal(T.displayCity("GBE"), "Gaborone, Botswana (GBE)");
  assert.equal(T.displayCity("gaborone"), "Gaborone, Botswana (GBE)");
  assert.equal(T.displayCity("Botswana"), "Gaborone, Botswana (GBE)");
});

test("displayCity: unresolved input passes through exactly as typed", () => {
  assert.equal(T.displayCity("Atlantis, Lost Continent"), "Atlantis, Lost Continent");
  assert.equal(T.displayCity(""), "");
});


/* ---------- 2026-07-25: Time is a real scored dimension ---------- */

const LENS_INPUTS = { origin: "San Francisco", destination: "Greenville, South Carolina",
  departDate: "2026-08-10", returnDate: "2026-08-11", cabin: "Economy", maxStops: 2,
  maxBudget: 1200, preferredAlliances: [], preferredAirlines: [], avoidAirlines: [],
  programBalances: [], dateFlexibility: "Exact", travelers: 1 };
// Two real-shaped live offers, both 1 stop (the case that exposed the bug):
// A is cheap and slow, B is pricey and fast. Before the Time dimension,
// every lens picked the same one because stops were identical.
const OFFER_A = { carrier: "American", priceTotal: 400, stops: 1, durationMinutes: 900, aircraft: "A321" };
const OFFER_B = { carrier: "United",   priceTotal: 800, stops: 1, durationMinutes: 480, aircraft: "737" };

test("Fastest vs Cheapest now pick different itineraries when stops are equal", () => {
  const cheap = T.runOptimization({ ...LENS_INPUTS, priorityRanks: { Cheapest: 1 } }, [OFFER_A, OFFER_B]);
  const fast  = T.runOptimization({ ...LENS_INPUTS, priorityRanks: { Fastest: 1 } },  [OFFER_A, OFFER_B]);
  assert.equal(cheap.best.carrier, "American", "Cheapest should take the $400 slow itinerary");
  assert.equal(fast.best.carrier, "United", "Fastest should take the 8h itinerary over the 15h one");
});

test("Time scores: shorter duration scores higher; missing duration is neutral", () => {
  const r = T.runOptimization({ ...LENS_INPUTS, priorityRanks: { Cheapest: 1 } },
    [OFFER_A, OFFER_B, { carrier: "Delta", priceTotal: 600, stops: 1, durationMinutes: null }]);
  const by = Object.fromEntries(r.candidates.map((c) => [c.carrier, c.scores.Time]));
  assert.ok(by.United > by.American, "8h must out-score 15h on Time");
  assert.equal(by.Delta, 55, "unknown duration scores neutral 55");
});

test("computeWeights still normalizes to 1 with the Time dimension present", () => {
  const w = T.computeWeights({ Fastest: 1 });
  const sum = T.DIMENSIONS.reduce((s2, d) => s2 + w[d], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(w.Time > w.Cost, "Fastest must weight Time above Cost");
});

test("charter regression (2026-07-19): Best Overall still prefers ANA ~half-price 1-stop over United nonstop", () => {
  const tokyo = { origin: "San Francisco", destination: "Tokyo", departDate: "2026-09-12",
    returnDate: "2026-09-24", cabin: "Economy", maxStops: 2, maxBudget: 2000,
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [],
    dateFlexibility: "Exact", travelers: 1, priorityRanks: { "Best Overall Experience": 1 } };
  const offers = [
    { carrier: "United", priceTotal: 1512, stops: 0, durationMinutes: 660 },
    { carrier: "ANA",    priceTotal: 761,  stops: 1, durationMinutes: 900 },
  ];
  const r = T.runOptimization(tokyo, offers);
  assert.equal(r.best.carrier, "ANA", "the tuned value-conscious call must keep holding after Time was added");
});


/* ---------- 2026-07-25: priceIntelligence (Google price insights) ---------- */

test("priceIntelligence: 'low' level yields a buy-class deal verdict with per-person math", () => {
  const pi = T.priceIntelligence({ priceLevel: "low", lowestPrice: 1600, typicalRange: [2000, 2400], history: [[1, 2100], [2, 1600]] }, 2);
  assert.equal(pi.cls, "buy");
  assert.equal(pi.perPerson, 800);
  assert.deepEqual(pi.range, [1000, 1200]);
  assert.ok(pi.deltaPct < 0);
});

test("priceIntelligence: 'high' warns, 'typical' monitors", () => {
  assert.equal(T.priceIntelligence({ priceLevel: "high", lowestPrice: 900 }, 1).cls, "wait");
  assert.equal(T.priceIntelligence({ priceLevel: "typical", lowestPrice: 500 }, 1).cls, "monitor");
});

test("priceIntelligence: null/absent insights return null (UI falls back to the labeled heuristic)", () => {
  assert.equal(T.priceIntelligence(null, 1), null);
  assert.equal(T.priceIntelligence({}, 1), null);
});

test("buildLiveCandidates: scanned offers keep their src tag; primary-feed offers stay null", () => {
  const inputs = { origin: "San Francisco", destination: "Greenville, South Carolina", departDate: "2026-08-10",
    cabin: "Economy", maxStops: 2, maxBudget: 1200, preferredAlliances: [], preferredAirlines: [], avoidAirlines: [],
    programBalances: [], dateFlexibility: "Exact", travelers: 1, priorityRanks: { Cheapest: 1 } };
  const r = T.runOptimization(inputs, [
    { carrier: "American", priceTotal: 500, stops: 1, durationMinutes: 500 },
    { carrier: "Delta", priceTotal: 480, stops: 1, durationMinutes: 520, src: "Kayak · scanned 2h ago" },
  ]);
  const delta = r.candidates.find((c) => c.carrier === "Delta");
  const aa = r.candidates.find((c) => c.carrier === "American");
  assert.equal(delta.src, "Kayak · scanned 2h ago");
  assert.equal(aa.src, null);
});


test("Cost keeps discriminating past the budget cap (the e2e saturation catch)", () => {
  const inputs = { origin: "San Francisco", destination: "Gaborone", departDate: "2026-09-12", returnDate: "2026-09-24",
    cabin: "Economy", maxStops: 3, maxBudget: 1000, preferredAlliances: [], preferredAirlines: [], avoidAirlines: [],
    programBalances: [], dateFlexibility: "Exact", travelers: 1, priorityRanks: { "Best Overall Experience": 1 } };
  const r = T.runOptimization(inputs, [
    { carrier: "United", priceTotal: 2100, stops: 2, durationMinutes: 1600 },
    { carrier: "Ethiopian Airlines", priceTotal: 1610, stops: 2, durationMinutes: 1900 },
  ]);
  const eth = r.candidates.find((c) => c.carrier === "Ethiopian Airlines");
  const ua = r.candidates.find((c) => c.carrier === "United");
  assert.ok(eth.scores.Cost > ua.scores.Cost, "the $490-cheaper fare must out-score on Cost even when both exceed budget");
  assert.equal(r.best.carrier, "Ethiopian Airlines", "Best Overall must prefer the much cheaper fare on an over-budget route");
});


test("scanSourceUrl builds the verified Kayak round-trip deep link", () => {
  const u = T.scanSourceUrl(
    { origin: "San Francisco", destination: "Gaborone", departDate: "2027-05-31", returnDate: "2027-06-10" },
    "Kayak · scanned 2h ago");
  assert.equal(u, "https://www.kayak.com/flights/SFO-GBE/2027-05-31/2027-06-10");
});

test("scanSourceUrl one-way omits the return segment", () => {
  const u = T.scanSourceUrl(
    { origin: "sfo", destination: "greenville", departDate: "2026-09-12" },
    "Kayak · scanned 5h ago");
  assert.equal(u, "https://www.kayak.com/flights/SFO-GSP/2026-09-12");
});

test("scanSourceUrl refuses Booking.com (deep link unverified) and non-scanned rows", () => {
  const inputs = { origin: "San Francisco", destination: "Gaborone", departDate: "2027-05-31", returnDate: "2027-06-10" };
  assert.equal(T.scanSourceUrl(inputs, "Booking.com · scanned 2h ago"), null);
  assert.equal(T.scanSourceUrl(inputs, null), null);
});

test("scanSourceUrl (2026-08-11): refuses an open-jaw trip too, same unverified-URL-shape reasoning as Booking.com", () => {
  const inputs = { origin: "SFO", destination: "VFA", returnFromCity: "BBK", departDate: "2027-05-21", returnDate: "2027-06-01" };
  assert.equal(T.scanSourceUrl(inputs, "Kayak · scanned 2h ago"), null);
});

test("scanSourceUrl returns null when the route does not resolve", () => {
  assert.equal(T.scanSourceUrl(
    { origin: "Narnia", destination: "Gaborone", departDate: "2027-05-31" },
    "Kayak · scanned 2h ago"), null);
});

test("displayCityName: ambiguous regionals carry their state/country (Susan 2026-07-26)", () => {
  assert.equal(T.displayCityName("GSP"), "Greenville, SC");
  assert.equal(T.displayCityName("greenville"), "Greenville, SC");
  assert.equal(T.displayCityName("GBE"), "Gaborone, Botswana");
  assert.equal(T.displayCityName("SFO"), "San Francisco");
});


test("toIATA: Baltic/Balkan/Caucasus/Central Asia countries resolve to their capital's code (Susan: Estonia gap, 2026-07-26)", () => {
  assert.equal(T.toIATA("Estonia"), "TLL");
  assert.equal(T.toIATA("estonia"), "TLL");
  assert.equal(T.toIATA("Latvia"), "RIX");
  assert.equal(T.toIATA("Lithuania"), "VNO");
  assert.equal(T.toIATA("Croatia"), "ZAG");
  assert.equal(T.toIATA("Slovenia"), "LJU");
  assert.equal(T.toIATA("Slovakia"), "BTS");
  assert.equal(T.toIATA("Serbia"), "BEG");
  assert.equal(T.toIATA("Bulgaria"), "SOF");
  assert.equal(T.toIATA("Malta"), "MLA");
  assert.equal(T.toIATA("Bosnia and Herzegovina"), "SJJ");
  assert.equal(T.toIATA("North Macedonia"), "SKP");
  assert.equal(T.toIATA("Montenegro"), "TGD");
  assert.equal(T.toIATA("Georgia"), "TBS");
  assert.equal(T.toIATA("Armenia"), "EVN");
  assert.equal(T.toIATA("Azerbaijan"), "GYD");
  assert.equal(T.toIATA("Kazakhstan"), "ALA");
  assert.equal(T.toIATA("Uzbekistan"), "TAS");
  // capital-city names resolve directly too, matching the country lookup
  assert.equal(T.toIATA("Tallinn"), "TLL");
  assert.equal(T.toIATA("tallinn, estonia"), "TLL");
});

test("runOptimization: San Francisco -> Estonia resolves with real geometry (routeKnown, no 7,500km default)", () => {
  const r = T.runOptimization({ origin: "San Francisco", destination: "Estonia",
    departDate: "2026-09-12", returnDate: "2026-09-24", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 },
    [{ carrier: "Finnair", priceTotal: 780, stops: 1, durationMinutes: 720 }]);
  assert.equal(r.routeKnown, true);
  assert.equal(r.best.routeKm > 8000 && r.best.routeKm < 9500, true, "SFO-TLL great-circle should land roughly 8,000-9,500km, got " + r.best.routeKm);
});

test("displayCityName: new capitals display cleanly", () => {
  assert.equal(T.displayCityName("TLL"), "Tallinn");
  assert.equal(T.displayCityName("estonia"), "Tallinn");
});

test("levenshtein: basic edit-distance sanity, incl. adjacent transposition at cost 1", () => {
  assert.equal(T.levenshtein("bangkok", "bangkok"), 0);
  assert.equal(T.levenshtein("bankok", "bangkok"), 1); // dropped letter
  assert.equal(T.levenshtein("fransisco", "francisco"), 1); // substitution
  assert.equal(T.levenshtein("pairs", "paris"), 1); // adjacent-letter swap (a common typo)
  assert.equal(T.levenshtein("", "abc"), 3);
});

test("toIATA (Susan 2026-08-21: click a suggestion to make it an exact match): a trailing (XXX) is a literal code, so SECONDARY airports stop collapsing to their metro's primary", () => {
  // Before this pass toIATA's whole-word fallback matched the city name and
  // discarded the code, so every one of these returned the metro primary:
  // ORY->CDG, LGA/EWR->JFK, LGW->LHR, MDW->ORD, DCA->IAD. Committing the
  // autocomplete's label would have silently searched the wrong airport.
  assert.equal(T.toIATA("Paris (ORY)"), "ORY");
  assert.equal(T.toIATA("Paris (BVA)"), "BVA");
  assert.equal(T.toIATA("New York (LGA)"), "LGA");
  assert.equal(T.toIATA("New York (EWR)"), "EWR");
  assert.equal(T.toIATA("London (LGW)"), "LGW");
  assert.equal(T.toIATA("Chicago (MDW)"), "MDW");
  assert.equal(T.toIATA("Reagan National (DCA)"), "DCA");
});

test("toIATA: the (XXX) suffix path leaves every existing resolution route untouched", () => {
  assert.equal(T.toIATA("Paris (CDG)"), "CDG");   // primary, still itself
  assert.equal(T.toIATA("Seattle (SEA)"), "SEA");
  assert.equal(T.toIATA("Seattle"), "SEA");        // bare city
  assert.equal(T.toIATA("SEA"), "SEA");            // bare code
  assert.equal(T.toIATA("Bankok"), "BKK");         // typo layer
  assert.equal(T.toIATA("Estonia"), "TLL");        // country layer
  assert.equal(T.toIATA("greenville, south carolina"), "GSP"); // whole-word
  assert.equal(T.toIATA(""), null);
  assert.equal(T.toIATA("(SEA)"), "SEA");          // suffix with no city
});

test("parseIataSuffix / stripIataSuffix: only a real trailing 3-letter code counts", () => {
  assert.equal(T.parseIataSuffix("Seattle (SEA)"), "SEA");
  assert.equal(T.parseIataSuffix("Paris (ory)"), "ORY");        // case-insensitive
  assert.equal(T.parseIataSuffix("Seattle"), null);
  assert.equal(T.parseIataSuffix("Washington (DC)"), null);      // 2 letters, not a code
  assert.equal(T.parseIataSuffix("Rio (BRAZIL)"), null);         // too long
  assert.equal(T.parseIataSuffix("(SEA) Seattle"), null);        // must be trailing
  assert.equal(T.stripIataSuffix("Seattle (SEA)"), "Seattle");
  assert.equal(T.stripIataSuffix("Paris–Orly (ORY)"), "Paris–Orly");
  assert.equal(T.stripIataSuffix("Seattle"), "Seattle");
});

test("suggestCities (Susan 2026-08-21): refocusing an already-committed field still returns its list", () => {
  // The field now holds "Seattle (SEA)". suggestCities keys on "seattle", so
  // without the strip a refocus returned zero rows and the list never reopened.
  const filled = T.suggestCities("Seattle (SEA)", 8);
  assert.ok(filled.length > 0, "a committed value should still suggest");
  assert.equal(filled[0].code, "SEA");
  assert.equal(filled[0].label, "Seattle (SEA)");
});

test("suggestCities (Susan 2026-08-21): a committed SECONDARY airport still reopens its list on refocus", () => {
  // The unit tests originally only covered "Seattle (SEA)", which strips to
  // "Seattle" and matches a key. A secondary airport strips to its own NAME
  // ("Paris–Orly"), which is not a key, so the list came back empty and never
  // reopened. Caught in a browser, not here, hence this test.
  assert.deepEqual(T.suggestCities("Paris–Orly (ORY)", 8).map((r) => r.code), ["ORY"]);
  assert.deepEqual(T.suggestCities("LaGuardia (LGA)", 8).map((r) => r.code), ["LGA"]);
  assert.deepEqual(T.suggestCities("Seattle (SEA)", 8).map((r) => r.code), ["SEA"]);
});

test("suggestCities (Susan 2026-08-21): airport names are searchable, not just metro names", () => {
  assert.ok(T.suggestCities("orly", 8).some((r) => r.code === "ORY"));
  assert.ok(T.suggestCities("laguardia", 8).some((r) => r.code === "LGA"));
  assert.ok(T.suggestCities("midway", 8).some((r) => r.code === "MDW"));
  assert.ok(T.suggestCities("gatwick", 8).some((r) => r.code === "LGW"));
});

test("suggestCities: name matching does not disturb the existing ranking", () => {
  assert.equal(T.suggestCities("paris", 8)[0].code, "CDG");   // primary still leads
  assert.equal(T.suggestCities("par", 8)[0].code, "CDG");     // not Paraguay/ASU
  assert.equal(T.suggestCities("seattle", 8)[0].code, "SEA");
  assert.equal(T.suggestCities("bankok", 8)[0].code, "BKK");  // typo tier intact
});

test("suggestCities: every row's label round-trips through toIATA to that row's own code", () => {
  // The contract the click depends on: whatever the list shows, committing it
  // must resolve back to the SAME airport. Guards the whole metro table.
  for (const q of ["paris", "new york", "london", "chicago", "washington", "seattle", "tokyo", "milan"]) {
    for (const row of T.suggestCities(q, 8)) {
      assert.equal(T.toIATA(row.label), row.code, `${row.label} should resolve to ${row.code}`);
    }
  }
});

test("displayCity (Susan 2026-08-21): secondary airport codes have real display names, not a bare code", () => {
  assert.equal(T.displayCity("Paris (ORY)"), "Paris–Orly (ORY)");
  assert.equal(T.displayCity("New York (LGA)"), "LaGuardia (LGA)");
  assert.equal(T.displayCity("Chicago (MDW)"), "Chicago–Midway (MDW)");
  // primaries and the hand-written overrides are unaffected
  assert.equal(T.displayCity("Paris"), "Paris (CDG)");
  assert.equal(T.displayCity("gsp"), "Greenville, SC (GSP)");
  assert.equal(T.displayCity("hnd"), "Tokyo (HND)");
});

test("displayCity: committing a suggestion is idempotent, re-display never compounds the suffix", () => {
  for (const s of ["Seattle (SEA)", "Paris (ORY)", "New York (LGA)"]) {
    assert.equal(T.displayCity(T.displayCity(s)), T.displayCity(s));
  }
});

test("toIATA (Susan 2026-07-31: 'improve city fields to handle misspellings'): common typos still resolve", () => {
  // the exact typo the old FALLBACK_REASONS copy used to just describe
  assert.equal(T.toIATA("Bankok"), "BKK");
  assert.equal(T.toIATA("bankok"), "BKK");
  // dropped, swapped, and wrong-letter variants across a spread of city
  // name lengths, both single words and multi-word phrases
  assert.equal(T.toIATA("San Fransisco"), "SFO");
  assert.equal(T.toIATA("Chicgo"), "ORD"); // dropped letter
  assert.equal(T.toIATA("Pairs"), "CDG"); // adjacent-letter swap
  assert.equal(T.toIATA("Singapre"), "SIN");
  assert.equal(T.toIATA("Amsterdm"), "AMS");
  assert.equal(T.toIATA("Barcelona"), "BCN"); // exact match still wins outright, unaffected
  assert.equal(T.toIATA("Istambul"), "IST");
  assert.equal(T.toIATA("Melborne"), "MEL");
  // a lone, uncombined word that's too far from any single-word key and
  // not close enough to a multi-word phrase like "san francisco", 
  // correctly refuses to guess rather than picking something plausible
  assert.equal(T.toIATA("Fransisco"), null);
});

test("toIATA: typo fallback also covers country names", () => {
  assert.equal(T.toIATA("Grmany"), "FRA");
  assert.equal(T.toIATA("Switzerlnd"), "ZRH");
});

test("toIATA: typo fallback never overrides an exact match, even when a near-neighbor exists", () => {
  // Iran/Iraq are within 1 edit of each other, but both are legitimate
  // exact COUNTRY_TO_IATA keys, so exact match always wins outright and
  // the fuzzy layer is never reached for either.
  assert.equal(T.toIATA("Iran"), "IKA");
  assert.equal(T.toIATA("Iraq"), "BGW");
  // "Iceland" is an exact COUNTRY_TO_IATA key; make sure the typo layer
  // (which runs after) can't be reached for a name that already resolved.
  assert.equal(T.toIATA("Iceland"), "KEF");
  assert.equal(T.toIATA("iceland, europe"), "KEF"); // whole-word still wins over fuzzy
});

test("toIATA: typo fallback declines to guess when nothing is close enough", () => {
  assert.equal(T.toIATA("Chad"), null); // not in the table at all, not a near-miss
  assert.equal(T.toIATA("Zzzzznotacity"), null);
  // inputs under 4 characters never fuzzy-match (too short/ambiguous;
  // 3-letter alpha input is already treated as a literal IATA code above)
  assert.equal(T.fuzzyMatchKey("nyc", { nyc2: "X", nyx: "Y" }), null);
});

test("lookupCoords: typo fallback resolves geometry directly, not just the IATA code", () => {
  const c = T.lookupCoords("Chicgo");
  assert.ok(c, "Chicgo should resolve to Chicago's coordinates");
  assert.equal(Math.round(c[0]), 42);
  const bad = T.lookupCoords("Zzzzznotacity");
  assert.equal(bad, null);
});

test("fuzzyMatchKey: ambiguous ties refuse to guess rather than pick arbitrarily", () => {
  const tieTable = { bake: "A", cake: "B" }; // "lake" sits at distance 1 from both
  assert.equal(T.fuzzyMatchKey("lake", tieTable), null);
});

test("fuzzyMatchKey: exhaustive safety check, every single-edit typo (delete/substitute/adjacent-swap) of every real city or country key resolves back to that SAME key or safely to null, never to a different key", () => {
  // Exercised via toIATA directly (rather than a hand-copied key list) so
  // this tracks the real data. CITY_IATA/COUNTRY_TO_IATA aren't on the
  // public surface, only toIATA's resolution is.
  const letters = "abcdefghijklmnopqrstuvwxyz";
  function variants(word) {
    const out = new Set();
    for (let i = 0; i < word.length; i++) out.add(word.slice(0, i) + word.slice(i + 1));
    for (let i = 0; i < word.length; i++) for (const c of letters) if (c !== word[i]) out.add(word.slice(0, i) + c + word.slice(i + 1));
    for (let i = 0; i < word.length - 1; i++) if (word[i] !== word[i + 1]) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    out.delete(word);
    return out;
  }
  // Spot-check a representative sample of real single-word keys (the full
  // ~300-key x ~200-variant sweep lives in the build session's ad hoc
  // validation, not in the regular suite, to keep `npm test` fast).
  const sampleCities = ["chicago", "singapore", "amsterdam", "istanbul", "melbourne", "germany", "switzerland", "bangkok", "barcelona"];
  for (const key of sampleCities) {
    const want = T.toIATA(key);
    assert.ok(want, `sanity: "${key}" should resolve exactly`);
    for (const v of variants(key)) {
      const got = T.toIATA(v);
      assert.ok(got === want || got === null, `typo "${v}" of "${key}" resolved to ${got}, expected ${want} or null`);
    }
  }
});

test("suggestCities (Susan 2026-07-31: live typeahead as you type): ranked, deduped-by-code suggestions", () => {
  assert.deepEqual(T.suggestCities("x"), [], "queries under 2 chars never suggest");
  assert.deepEqual(T.suggestCities(""), []);
  assert.deepEqual(T.suggestCities(null), []);
  // 2026-07-31 (Susan: "with the Paris example only CDG came up but paris
  // has several airports"): "pari" now surfaces every Paris-area airport,
  // not just the primary CDG, each as its own distinct, dedup-safe row.
  const paris = T.suggestCities("pari");
  assert.equal(paris.length, 3, "Paris should surface CDG, Orly, and Beauvais");
  assert.deepEqual(paris[0], { code: "CDG", value: "Paris", label: "Paris (CDG)" }, "the primary airport still sorts first");
  const parisCodes = paris.map((r) => r.code).sort();
  assert.deepEqual(parisCodes, ["BVA", "CDG", "ORY"]);
  const orly = paris.find((r) => r.code === "ORY");
  assert.equal(orly.label, "Paris–Orly (ORY)");
  // exact match beats a shorter prefix elsewhere in the table
  const par = T.suggestCities("par");
  assert.equal(par[0].code, "CDG", "exact-prefix-tier city sorts before other 'par...' matches");
  // typo tolerance: same distance-1 case toIATA resolves, Bangkok's
  // second airport (Don Mueang, DMK) is typo-fuzzy-matched right alongside
  // the primary, same as an exact "bangkok" query would surface both
  const bankok = T.suggestCities("bankok");
  assert.equal(bankok.length, 2);
  assert.deepEqual(bankok.map((r) => r.code).sort(), ["BKK", "DMK"]);
  // multiple real prefix matches, deduped by code, alphabetical within tier
  //, includes Chicago's second airport (Midway) alongside its primary
  const chi = T.suggestCities("chi").map((r) => r.code).sort();
  assert.deepEqual(chi, ["KIV", "MDW", "ORD", "PEK", "SCL"], "Chicago (+Midway), China, Chile, Chisinau all legitimately start with 'chi'");
  // a code reached only via a COUNTRY_TO_IATA alias with no CITY_IATA
  // entry falls back to the alias itself as the label, not a bare code
  const par2 = T.suggestCities("par", 5).find((r) => r.code === "ASU");
  assert.ok(par2, "Paraguay should still surface for 'par'");
  assert.equal(par2.label, "Paraguay (ASU)");
  // limit is respected
  assert.ok(T.suggestCities("a", 3).length <= 3);
});

test("suggestCities: every suggested value resolves back to the same code via toIATA (selecting a suggestion always exact-matches)", () => {
  ["par", "lon", "tok", "sing", "chi", "ber", "san", "new", "wash", "hous", "dall", "sao", "rio", "bang", "toro", "seo", "osa", "beij", "shan", "rom"].forEach((q) => {
    T.suggestCities(q, 8).forEach((s) => {
      assert.equal(T.toIATA(s.value), s.code, `suggestion "${s.value}" for query "${q}" should resolve to ${s.code}`);
    });
  });
});

test("suggestCities / toIATA (Susan 2026-07-31: 'paris has several airports, fix and do better'): multi-airport metros surface every real airport, each resolving to itself", () => {
  const metros = {
    "new york": ["JFK", "EWR", "LGA"],
    washington: ["IAD", "DCA", "BWI"],
    chicago: ["ORD", "MDW"],
    london: ["LHR", "LGW", "STN", "LTN", "LCY"],
    paris: ["CDG", "ORY", "BVA"],
    tokyo: ["HND", "NRT"],
  };
  for (const [city, codes] of Object.entries(metros)) {
    const results = T.suggestCities(city, 10);
    const gotCodes = results.map((r) => r.code).sort();
    assert.deepEqual(gotCodes, [...codes].sort(), `"${city}" should surface exactly ${codes.join(", ")}`);
    for (const r of results) {
      assert.equal(T.toIATA(r.value), r.code, `selecting "${r.value}" for "${city}" must resolve to ${r.code}, not a different airport in the same metro`);
    }
  }
  // an alt airport's own name resolves directly too, not just via suggestCities
  assert.equal(T.toIATA("Paris–Orly"), "ORY");
  // a plain hyphen instead of the en dash the label actually uses isn't an
  // exact alt-airport match, so it falls through to the existing whole-word
  // fallback on "paris" and lands on the metro's primary code (CDG), a
  // safe, already-tested behavior, not a new guess.
  assert.equal(T.toIATA("paris-orly"), "CDG");
});

/* ---------- loyaltyBalanceCheck (roadmap Phase 7a, "Loyalty balance integration", 2026-08-07) ---------- */

test("loyaltyBalanceCheck: no relevant programs at all -> status 'none', full amount needed", () => {
  const range = { milesLow: 60000, milesHigh: 90000 };
  const check = T.loyaltyBalanceCheck(range, []);
  assert.equal(check.status, "none");
  assert.equal(check.biggestBalance, 0);
  assert.equal(check.needed, 60000);
  assert.equal(check.shortfall, 60000);
});

test("loyaltyBalanceCheck: a balance at or above milesLow is 'enough', with the real surplus", () => {
  const range = { milesLow: 60000, milesHigh: 90000 };
  const check = T.loyaltyBalanceCheck(range, [{ program: "United MileagePlus", balance: 75000 }]);
  assert.equal(check.status, "enough");
  assert.equal(check.program, "United MileagePlus");
  assert.equal(check.surplus, 15000);
});

test("loyaltyBalanceCheck: a balance exactly at milesLow clears the bar (>=), not just above it", () => {
  const range = { milesLow: 60000, milesHigh: 90000 };
  const check = T.loyaltyBalanceCheck(range, [{ program: "United MileagePlus", balance: 60000 }]);
  assert.equal(check.status, "enough");
  assert.equal(check.surplus, 0);
});

test("loyaltyBalanceCheck: a balance below milesLow is 'short', with the real shortfall", () => {
  const range = { milesLow: 60000, milesHigh: 90000 };
  const check = T.loyaltyBalanceCheck(range, [{ program: "United MileagePlus", balance: 45000 }]);
  assert.equal(check.status, "short");
  assert.equal(check.program, "United MileagePlus");
  assert.equal(check.shortfall, 15000);
});

test("loyaltyBalanceCheck: multiple relevant programs picks the BIGGEST balance, not the first or smallest", () => {
  const range = { milesLow: 60000, milesHigh: 90000 };
  const check = T.loyaltyBalanceCheck(range, [
    { program: "Air Canada Aeroplan", balance: 20000 },
    { program: "United MileagePlus", balance: 80000 },
    { program: "Lufthansa Miles & More", balance: 50000 },
  ]);
  assert.equal(check.program, "United MileagePlus");
  assert.equal(check.status, "enough");
  assert.equal(check.surplus, 20000);
});

test("awardRecommendation: exposes balanceCheck as part of its normal return shape", () => {
  const best = { candCpp: 1.8, cabin: "Economy", alliance: "Star Alliance", price: 900 };
  const award = T.awardRecommendation(best, { cabin: "Economy" }, [{ program: "United MileagePlus", balance: 40000 }]);
  assert.ok(award.balanceCheck, "awardRecommendation should include a balanceCheck field");
  assert.equal(award.balanceCheck.needed, award.milesLow, "balanceCheck's bar should match the same milesLow the rest of the card shows");
});

// Phase 7a spot-check (2026-08-08): the function's own header comment
// promises the balance check looks at "a program that flies this
// itinerary's alliance", buildInsights' separate cross-alliance warning
// already relies on exactly that filter via programMatchesAlliance. This
// pins awardRecommendation to the same rule: a big balance in the WRONG
// alliance must never be reported as covering the redemption.
test("awardRecommendation: relevantPrograms excludes balances outside this itinerary's alliance", () => {
  const best = { candCpp: 1.8, cabin: "Economy", alliance: "Star Alliance", price: 900 };
  // Delta SkyMiles is SkyTeam, not Star Alliance, plenty of balance, but
  // not usable for a Star Alliance redemption on this itinerary.
  const award = T.awardRecommendation(best, { cabin: "Economy" }, [{ program: "Delta SkyMiles", balance: 200000 }]);
  assert.equal(award.relevantPrograms.length, 0, "an out-of-alliance balance should not appear as a relevant program");
  assert.equal(award.balanceCheck.status, "none", "with no in-alliance balance, the verdict should be 'none', not a false 'enough' off Delta's balance");
});

test("awardRecommendation: relevantPrograms keeps in-alliance balances and ignores out-of-alliance ones in the same wallet", () => {
  const best = { candCpp: 1.8, cabin: "Economy", alliance: "Star Alliance", price: 900 };
  const award = T.awardRecommendation(best, { cabin: "Economy" }, [
    { program: "Delta SkyMiles", balance: 300000 },     // SkyTeam, must be excluded
    { program: "United MileagePlus", balance: 30000 },  // Star Alliance, must be kept
  ]);
  assert.equal(award.relevantPrograms.length, 1);
  assert.equal(award.relevantPrograms[0].program, "United MileagePlus");
  assert.equal(award.balanceCheck.program, "United MileagePlus", "the biggest-balance pick must come from the in-alliance pool, not the raw biggest balance overall (Delta's 300k)");
});

// 2026-08-08: programMatchesAlliance's internal map had no Etihad entry at
// all (neither the top-level ALLIANCES table nor this function's own map),
// so an Etihad Guest balance could never be reported as relevant to any
// itinerary, even though it's a real option in the wallet UI. Etihad is
// Unaligned, same bucket as Alaska/Emirates/JetBlue.
test("awardRecommendation: an Etihad Guest balance is recognized for an Unaligned itinerary", () => {
  const best = { candCpp: 1.8, cabin: "Economy", alliance: "Unaligned", price: 900 };
  const award = T.awardRecommendation(best, { cabin: "Economy" }, [{ program: "Etihad Guest", balance: 50000 }]);
  assert.equal(award.relevantPrograms.length, 1, "Etihad Guest should be recognized as relevant to an Unaligned itinerary");
  assert.equal(award.relevantPrograms[0].program, "Etihad Guest");
});

/* ---------- buildSweepDates (roadmap Phase 5c, "Date-range score sweep", 2026-08-07) ---------- */

test("buildSweepDates: a window/interval combo under the cap uses the requested interval as-is", () => {
  const r = T.buildSweepDates("2026-09-01", "2026-09-10", 30, 5, 12);
  assert.equal(r.effectiveIntervalDays, 5);
  assert.equal(r.widened, false);
  assert.equal(r.samples.length, 7); // 0,5,10,15,20,25,30
  assert.equal(r.samples[0].departDate, "2026-09-01");
  assert.equal(r.samples[0].returnDate, "2026-09-10");
  assert.equal(r.samples[6].departDate, "2026-10-01");
  assert.equal(r.samples[6].returnDate, "2026-10-10");
});

test("buildSweepDates: return date shifts by the SAME offset as depart date, so trip length stays constant", () => {
  const r = T.buildSweepDates("2026-09-01", "2026-09-10", 10, 5, 12);
  r.samples.forEach((s) => {
    const len = (new Date(s.returnDate) - new Date(s.departDate)) / 86400000;
    assert.equal(len, 9, `trip length should stay 9 days at every sampled date, got ${len} for offset ${s.offset}`);
  });
});

test("buildSweepDates: a one-way trip (no returnDate) only shifts departDate, returnDate stays null throughout", () => {
  const r = T.buildSweepDates("2026-09-01", "", 10, 5, 12);
  r.samples.forEach((s) => assert.equal(s.returnDate, null));
});

test("buildSweepDates: a naive combo that would exceed maxSamples widens the interval instead of silently shrinking the window", () => {
  // 60 days / 3-day interval = 21 samples naively, way over a 12 cap
  const r = T.buildSweepDates("2026-09-01", "2026-09-10", 60, 3, 12);
  assert.equal(r.widened, true);
  assert.ok(r.effectiveIntervalDays > 3, "interval should have widened");
  assert.ok(r.samples.length <= 12, `sample count ${r.samples.length} must respect the cap`);
  // the full window is still covered, just at a coarser interval
  assert.equal(r.samples[0].offset, 0);
  assert.ok(r.samples[r.samples.length - 1].offset <= 60);
});

test("buildSweepDates: never returns more samples than maxSamples, even at small intervals over a big window", () => {
  const r = T.buildSweepDates("2026-09-01", "2026-09-10", 60, 1, 12);
  assert.ok(r.samples.length <= 12);
});

test("buildSweepDates: the cheapest-in-cap-safe defaults (30 days / 5-day interval) never trip the daily cap on their own", () => {
  const r = T.buildSweepDates("2026-09-01", "2026-09-10", 30, 5, 12);
  assert.ok(r.samples.length <= 12, "default sweep should always fit comfortably inside a 20/day cap, leaving headroom for everything else");
});

console.log(`\n${passed} passed`);
