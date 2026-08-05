// netlify/functions/lib/city-coords.mjs
// version: 1 (2026-08-05, same-day fix — see below)
//
// A DELIBERATE, verified-in-sync duplicate of app.js's CITY_COORDS table,
// for use ONLY by Netlify Functions (currently watched-trips.mjs).
//
// Why a duplicate instead of one shared source: the original build of
// watched-trips.mjs loaded app.js's table at runtime via
// `createRequire(import.meta.url)("../../app.js")`, reusing the same
// stub-`window`-and-require trick tests/app.test.js already uses to run
// app.js under plain Node. That worked in every local test and in
// `node --check`, but broke in actual production: Netlify's function
// bundler (esbuild) only packages files it can see through STATIC
// imports. A dynamic require() to a path outside the function's own
// directory tree is invisible to it, so app.js silently never made it
// into the deployed bundle — the function threw "Cannot find module" on
// every real invocation, and every call returned a 502. Caught the same
// day this shipped, once Susan reported not seeing the feature live.
//
// This file is the standard fix for that class of bug: move the shared
// data into something the bundler's static analysis actually sees — a
// real `import` inside netlify/functions/. It costs a second copy of the
// same ~170 entries, which the old design specifically tried to avoid
// (see this repo's CLAUDE.md, "Concert Radar ... built" entry) — but a
// working duplicate beats an elegant approach that 502s in production.
// Kept honest: tests/watched-trips.test.mjs has a dedicated assertion
// that loads app.js's CITY_COORDS the SAME way the old runtime code did
// (createRequire, safe in a Node test process, just not in the deployed
// function) and diffs every key/value against this file — any future
// edit to one table without the other fails the test suite, not just a
// silent runtime drift.
//
// 2026-08-05, same-day follow-up: Susan's watched Chicago trip
// (destIata "ORD") came back in meta.unmapped even after the 502 fix
// above — a second, separate bug, this one in app.js's table itself
// (predates this file, copied straight over): CITY_IATA maps 163 city
// names to a primary code, but 79 of those codes (including ORD) were
// never ALSO a CITY_COORDS key in their own right — only the city NAME
// was. That's invisible to app.js's own lookupCoords(), which has a
// whole-word/fuzzy fallback chain that resolves free-text input like
// "chicago" just fine, but buildWatchedTripsView() below does a plain
// exact-match lookup on an already-resolved code, which has no such
// fallback. Fixed by adding every missing code as its own key
// (mechanically generated from the matching city-name entry — same
// coordinates, not independently sourced) plus 5 cities that had no
// coordinate at all under either name or code (Muscat, Damascus, Minsk,
// Nicosia, Kyiv — added from public capital-city coordinates). See the
// dated comment directly in app.js's own CITY_COORDS table for the same
// note there.
//
export const CITY_COORDS = {
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
  greenville: [34.90, -82.22], gsp: [34.90, -82.22], spartanburg: [34.90, -82.22],
  gaborone: [-24.56, 25.92], gbe: [-24.56, 25.92],
  tallinn: [59.41, 24.83], tll: [59.41, 24.83], riga: [56.92, 23.97], rix: [56.92, 23.97],
  vilnius: [54.63, 25.29], vno: [54.63, 25.29], chisinau: [46.93, 28.93], kiv: [46.93, 28.93],
  zagreb: [45.74, 16.07], zag: [45.74, 16.07], ljubljana: [46.22, 14.46], lju: [46.22, 14.46],
  bratislava: [48.17, 17.21], bts: [48.17, 17.21], belgrade: [44.82, 20.31], beg: [44.82, 20.31],
  sofia: [42.70, 23.41], sof: [42.70, 23.41], tirana: [41.41, 19.72], tia: [41.41, 19.72],
  valletta: [35.86, 14.48], mla: [35.86, 14.48], sarajevo: [43.82, 18.33], sjj: [43.82, 18.33],
  skopje: [41.96, 21.62], skp: [41.96, 21.62], podgorica: [42.36, 19.25], tgd: [42.36, 19.25],
  pristina: [42.57, 21.04], prn: [42.57, 21.04],
  tbilisi: [41.67, 44.95], tbs: [41.67, 44.95], yerevan: [40.15, 44.40], evn: [40.15, 44.40],
  baku: [40.47, 50.05], gyd: [40.47, 50.05], almaty: [43.35, 77.04], ala: [43.35, 77.04],
  tashkent: [41.26, 69.28], tas: [41.26, 69.28],
  // 2026-07-24 US regional coverage pass (paired with CITY_IATA below):
  sacramento: [38.70, -121.59], smf: [38.70, -121.59], burbank: [34.20, -118.36], bur: [34.20, -118.36],
  "santa ana": [33.68, -117.87], "orange county": [33.68, -117.87], sna: [33.68, -117.87],
  "palm springs": [33.83, -116.51], psp: [33.83, -116.51], fresno: [36.78, -119.72], fat: [36.78, -119.72],
  reno: [39.50, -119.77], rno: [39.50, -119.77], boise: [43.56, -116.22], boi: [43.56, -116.22],
  spokane: [47.62, -117.53], geg: [47.62, -117.53], "salt lake city": [40.79, -111.98], slc: [40.79, -111.98],
  tucson: [32.12, -110.94], tus: [32.12, -110.94], albuquerque: [35.04, -106.61], abq: [35.04, -106.61],
  "el paso": [31.81, -106.38], elp: [31.81, -106.38], "san antonio": [29.53, -98.47], sat: [29.53, -98.47],
  "kansas city": [39.30, -94.71], mci: [39.30, -94.71], "st louis": [38.75, -90.37], "saint louis": [38.75, -90.37], stl: [38.75, -90.37],
  "new orleans": [29.99, -90.26], msy: [29.99, -90.26], memphis: [35.04, -89.98], mem: [35.04, -89.98],
  nashville: [36.12, -86.68], bna: [36.12, -86.68], louisville: [38.17, -85.74], sdf: [38.17, -85.74],
  lexington: [38.04, -84.61], lex: [38.04, -84.61], cincinnati: [39.05, -84.66], cvg: [39.05, -84.66],
  columbus: [40.00, -82.89], cmh: [40.00, -82.89], cleveland: [41.41, -81.85], cle: [41.41, -81.85],
  pittsburgh: [40.49, -80.23], pit: [40.49, -80.23], indianapolis: [39.72, -86.29], ind: [39.72, -86.29],
  milwaukee: [42.95, -87.90], mke: [42.95, -87.90], omaha: [41.30, -95.89], oma: [41.30, -95.89],
  "des moines": [41.53, -93.66], dsm: [41.53, -93.66], "oklahoma city": [35.39, -97.60], okc: [35.39, -97.60],
  tulsa: [36.20, -95.89], tul: [36.20, -95.89], baltimore: [39.18, -76.67], bwi: [39.18, -76.67],
  hartford: [41.94, -72.68], bdl: [41.94, -72.68], providence: [41.72, -71.43], pvd: [41.72, -71.43],
  buffalo: [42.94, -78.73], buf: [42.94, -78.73], rochester: [43.12, -77.67], roc: [43.12, -77.67],
  syracuse: [43.11, -76.11], syr: [43.11, -76.11], albany: [42.75, -73.80], alb: [42.75, -73.80],
  raleigh: [35.88, -78.79], durham: [35.88, -78.79], rdu: [35.88, -78.79], richmond: [37.51, -77.32], ric: [37.51, -77.32],
  norfolk: [36.89, -76.20], orf: [36.89, -76.20], columbia: [33.94, -81.12], cae: [33.94, -81.12],
  charleston: [32.90, -80.04], chs: [32.90, -80.04], savannah: [32.13, -81.20], sav: [32.13, -81.20],
  asheville: [35.44, -82.54], avl: [35.44, -82.54], knoxville: [35.81, -83.99], tys: [35.81, -83.99],
  chattanooga: [35.04, -85.20], cha: [35.04, -85.20], birmingham: [33.56, -86.75], bhm: [33.56, -86.75],
  jacksonville: [30.49, -81.69], jax: [30.49, -81.69], "fort lauderdale": [26.07, -80.15], fll: [26.07, -80.15],
  "west palm beach": [26.68, -80.10], pbi: [26.68, -80.10], "fort myers": [26.54, -81.76], rsw: [26.54, -81.76],
  sarasota: [27.40, -82.55], srq: [27.40, -82.55],
  // 2026-07-31 (Susan: "paris has several airports"): coordinates for every
  // CITY_ALT_AIRPORTS code above that didn't already have an entry — a few
  // (oak, sjc, bur, sna, bwi, nrt) were already here as standalone cities
  // and are reused as-is.
  lga: [40.78, -73.87], dca: [38.85, -77.04], mdw: [41.79, -87.75],
  lgb: [33.82, -118.15], ont: [34.06, -117.60], hou: [29.65, -95.28], dal: [32.85, -96.85],
  lgw: [51.15, -0.18], stn: [51.89, 0.24], ltn: [51.87, -0.37], lcy: [51.51, 0.06],
  ory: [48.73, 2.36], bva: [49.45, 2.11], itm: [34.79, 135.44], sha: [31.20, 121.34],
  pkx: [39.51, 116.41], gmp: [37.56, 126.80], cia: [41.80, 12.59], aep: [-34.56, -58.42],
  cgh: [-23.63, -46.66], sdu: [-22.91, -43.16], dmk: [13.91, 100.61], ytz: [43.63, -79.40],
  // 2026-08-05 (found while diagnosing why watched-trips.mjs's Chicago
  // lookup came back unmapped — Susan asked "who's playing in Chicago
  // during my trip" and the answer required this table first): CITY_IATA
  // maps 163 city names to a primary code, but only a minority of those
  // codes were ALSO present here as their own key — the rest (Chicago/ORD
  // among them) only resolved via lookupCoords()'s whole-word/fuzzy
  // fallback chain, which only works for FREE-TEXT city-name input, not a
  // bare already-resolved code like watch.mjs's stored destIata. Every
  // code below is the SAME coordinate pair as its city-name entry above —
  // mechanically generated by cross-referencing CITY_IATA against this
  // table, not independently sourced, so there's nothing new to verify
  // beyond what was already here. Five codes (mct, dam, msq, lca, kbp)
  // had no coordinate entry at all under either name or code — added from
  // public capital-city coordinates (Muscat, Damascus, Minsk, Nicosia,
  // Kyiv/Boryspil) since this table had literally nothing to copy from
  // for those five. This does not change any existing resolution — it
  // only adds a fast, exact-match path for codes lookupCoords() could
  // already reach the slow way; app.js's own comment above lookupCoords's
  // fuzzy-fallback block (search "not every CITY_COORDS key has a
  // same-name key") predicted this exact gap and can be retired now that
  // it's closed.
  akl: [-37.01, 174.79], ams: [52.31, 4.76], anc: [61.17, -150.00], arn: [59.65, 17.92],
  ath: [37.94, 23.94], atl: [33.64, -84.43], aus: [30.19, -97.67], bcn: [41.30, 2.08],
  ber: [52.36, 13.50], bkk: [13.69, 100.75], bog: [4.70, -74.15], bom: [19.09, 72.87],
  bos: [42.36, -71.01], cai: [30.12, 31.41], clt: [35.21, -80.94], cmn: [33.37, -7.59],
  cph: [55.62, 12.66], cpt: [-33.96, 18.60], cun: [21.04, -86.87], dam: [33.51, 36.28],
  del: [28.56, 77.10], den: [39.86, -104.67], dfw: [32.90, -97.04], doh: [25.27, 51.61],
  dtw: [42.21, -83.35], dub: [53.43, -6.25], dxb: [25.25, 55.36], edi: [55.95, -3.37],
  eze: [-34.82, -58.54], fra: [50.03, 8.56], gig: [-22.81, -43.25], gru: [-23.43, -46.47],
  gva: [46.24, 6.11], hel: [60.32, 24.96], hkg: [22.31, 113.91], hnl: [21.32, -157.92],
  iad: [38.95, -77.46], iah: [29.98, -95.34], ist: [41.26, 28.74], jnb: [-26.14, 28.25],
  kbp: [50.45, 30.52], kef: [63.99, -22.61], kix: [34.43, 135.23], las: [36.08, -115.15],
  lca: [35.17, 33.36], lim: [-12.02, -77.11], lis: [38.77, -9.13], mad: [40.47, -3.56],
  mco: [28.43, -81.31], mct: [23.59, 58.38], mel: [-37.67, 144.84], mex: [19.44, -99.07],
  mia: [25.79, -80.29], mnl: [14.51, 121.02], msp: [44.88, -93.22], msq: [53.90, 27.56],
  muc: [48.35, 11.79], nbo: [-1.32, 36.93], ord: [41.98, -87.90], osl: [60.19, 11.10],
  pdx: [45.59, -122.60], pek: [40.08, 116.58], phl: [39.87, -75.24], phx: [33.43, -112.01],
  prg: [50.10, 14.26], pvg: [31.14, 121.81], san: [32.73, -117.19], scl: [-33.39, -70.79],
  sea: [47.45, -122.31], sin: [1.36, 103.99], syd: [-33.95, 151.18], tlv: [32.01, 34.89],
  tpa: [27.98, -82.53], tpe: [25.08, 121.23], vie: [48.11, 16.57], yul: [45.47, -73.74],
  yvr: [49.19, -123.18], yyz: [43.68, -79.63], zrh: [47.46, 8.55],
};
