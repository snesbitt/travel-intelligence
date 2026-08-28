// netlify/functions/lib/cabin-class.mjs
// version: 1 (2026-08-28)
//
// SerpApi's Google Flights `travel_class` parameter, keyed by this
// repo's own cabin names. Was defined identically in fares.mjs and
// watch-check.mjs (copy-pasted, not shared) -- the two places that build
// a SerpApi request. Extracted here, same "shared lib for Netlify
// Functions" pattern as city-coords.mjs (see that file's header for why
// this is a real static `import`, not a dynamic require: the bundler
// only sees static imports, and this table is small enough that a
// duplicate was never the concern city-coords.mjs's header describes --
// this is a plain refactor, not a bug fix for a bundler blind spot).
//
// "Best Value" and any other cabin name this repo accepts but SerpApi
// doesn't model has no entry here on purpose: both call sites already
// guard with `if (CABIN_CLASS[cabin]) ...` and simply omit
// travel_class when there's no mapping, letting SerpApi apply its own
// default rather than this table guessing.
export const CABIN_CLASS = { Economy: "1", "Premium Economy": "2", Business: "3", First: "4" };
