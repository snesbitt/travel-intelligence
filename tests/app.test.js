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

console.log(`\n${passed} passed`);
