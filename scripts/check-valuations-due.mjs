#!/usr/bin/env node
// Early warning for the hand-copied TPG valuations table (2026-10-20).
//
// check-content-drift.mjs fails the whole test suite once the table is
// older than POINT_VALUATIONS.staleAfterDays (45). That is the right hard
// stop, but on its own it only fires AFTER the deadline, on every push,
// and blocks unrelated commits. It fired on 2026-09-02 and again on
// 2026-10-20 with nothing earlier to say a refresh was coming.
//
// This check is the earlier signal. TPG publishes a new table on the 1st
// of each month, so the copy is "due" as soon as a calendar month (UTC)
// has started that is later than the month of copiedOn. It is read-only,
// writes nothing, and has no authority to change the table: a refresh
// must be re-copied from the live page by a person (see CLAUDE.md,
// 2026-10-20), never filled in with a plausible number.
//
// Run by the daily scheduled job in .github/workflows/test.yml, which
// opens or updates the tracking issue when this exits 1. Not part of
// `npm test`, so it can never block a push.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
global.window = {};
require(process.cwd() + "/app.js");
const T = global.window.TravelIntel;
const V = T && T.POINT_VALUATIONS;

if (!V || !/^\d{4}-\d{2}-\d{2}$/.test(V.copiedOn || "")) {
  console.error("POINT_VALUATIONS.copiedOn is missing or malformed; cannot tell whether a refresh is due.");
  process.exit(1);
}

const copied = new Date(V.copiedOn + "T00:00:00Z");
const now = new Date();
const monthsBehind =
  (now.getUTCFullYear() - copied.getUTCFullYear()) * 12 + (now.getUTCMonth() - copied.getUTCMonth());
const age = T.valuationAge();
const hardStopIn = V.staleAfterDays - age.days;

if (monthsBehind >= 1) {
  console.error(
    `TPG valuations refresh is due: the table was copied ${V.copiedOn} (${age.days} days ago) and TPG has since published a new month. ` +
      `The build starts failing in ${Math.max(hardStopIn, 0)} day(s). ` +
      "Re-copy from thepointsguy.com/loyalty-programs/monthly-valuations/ (read the live page directly, not a summary), " +
      "then update the figures, asOf and copiedOn in app.js.",
  );
  process.exit(1);
}

console.log(`Valuations are current: copied ${V.copiedOn}, ${age.days} days ago, same month as today.`);
