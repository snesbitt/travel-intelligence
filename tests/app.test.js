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

test("expanded city tables: new US regionals resolve with real geometry (no 7,500 km default)", () => {
  for (const [city, code] of [["Nashville", "BNA"], ["Savannah", "SAV"], ["Charleston", "CHS"], ["fort lauderdale", "FLL"]]) {
    assert.equal(T.toIATA(city), code);
  }
  const r = T.runOptimization({ origin: "San Francisco", destination: "Nashville",
    departDate: "2026-08-10", cabin: "Economy", maxStops: 2, priorityRanks: {},
    preferredAlliances: [], preferredAirlines: [], avoidAirlines: [], programBalances: [], dateFlexibility: "Exact", travelers: 1 });
  assert.equal(r.routeKnown, true);
});


/* ---------- 2026-07-24: displayCity — code or name in, city out ---------- */

test("displayCity: airport code in, city name out", () => {
  assert.equal(T.displayCity("GSP"), "Greenville (GSP)");
  assert.equal(T.displayCity("gsp"), "Greenville (GSP)");
  assert.equal(T.displayCity("SFO"), "San Francisco (SFO)");
});

test("displayCity: city name in, canonical 'City (CODE)' out (incl. multiword title-case)", () => {
  assert.equal(T.displayCity("san francisco"), "San Francisco (SFO)");
  assert.equal(T.displayCity("Greenville, South Carolina"), "Greenville (GSP)");
  assert.equal(T.displayCity("salt lake city"), "Salt Lake City (SLC)");
});

test("displayCityName: city only, no code suffix (watched-row rendering)", () => {
  assert.equal(T.displayCityName("SFO"), "San Francisco");
  assert.equal(T.displayCityName("GBE"), "Gaborone");
  assert.equal(T.displayCityName("Atlantis"), "Atlantis");
});

test("displayCity: Gaborone resolves from code, city, or country (watched-trip fix)", () => {
  assert.equal(T.displayCity("GBE"), "Gaborone (GBE)");
  assert.equal(T.displayCity("gaborone"), "Gaborone (GBE)");
  assert.equal(T.displayCity("Botswana"), "Gaborone (GBE)");
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

test("scanSourceUrl returns null when the route does not resolve", () => {
  assert.equal(T.scanSourceUrl(
    { origin: "Narnia", destination: "Gaborone", departDate: "2027-05-31" },
    "Kayak · scanned 2h ago"), null);
});

console.log(`\n${passed} passed`);
