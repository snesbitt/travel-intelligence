// tests/app.test.js
// Minimal, dependency-free tests for app.js's pure functions. No test
// framework — plain Node `assert`, run via `node tests/app.test.js` (see
// the "test" script in package.json). app.js is a browser script (no
// module.exports), so it's loaded here the way index.html loads it: by
// giving it a `window` to attach `window.TravelIntel` to, then reading
// that object back out. Nothing here touches the network or the DOM —
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
  const asianCarrier = T.ASIAN_CARRIERS[0]; // e.g. "ANA" — pulled from the live list, not hardcoded
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
  // Tight budget still wins over a saved "Luxury" style — trip-specific
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
  const r = T.runOptimization({ origin: "San Francisco", destination: "Greenville, South Carolina",
    departDate: "2026-08-10", returnDate: "2026-08-11", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 });
  assert.equal(r.routeKnown, true);
  // 9h34m was the giveaway: 7,500km default. Real GSP geometry must model well under 6h nonstop air time.
  const nonstops = r.candidates.filter((c) => c.stops === 0);
  for (const c of nonstops) assert.ok(c.travelMinutes < 360, "nonstop modeled over 6h: " + c.travelMinutes);
});

test("runOptimization: unresolved city reports routeKnown=false", () => {
  const r = T.runOptimization({ origin: "San Francisco", destination: "Atlantis, Lost Continent",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 });
  assert.equal(r.routeKnown, false);
});

console.log(`\n${passed} passed`);
