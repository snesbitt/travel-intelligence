#!/usr/bin/env node
// Content-drift check for Travel Intelligence, same idea as Streaming Scout's
// scripts/check-content-drift.mjs (2026-08-08): about.html's "7 scored
// dimensions" / "7 weighted priorities" stat tiles are hand-typed numbers
// that describe app.js's own DIMENSIONS array and PRIORITY_WEIGHTS object.
// Nothing enforced them staying in sync until now — this fails loudly if a
// future edit adds/removes a dimension or a priority lens in app.js without
// updating the about.html copy that quotes the count.
//
// Add a new check here whenever a future session catches a new instance of
// "the page said X but the code said Y" by hand, so it stops needing to be
// caught by hand.

import { readFileSync } from "node:fs";

let failures = [];

const appJs = readFileSync("app.js", "utf8");
const about = readFileSync("about.html", "utf8");

// Check 1: "N scored dimensions" matches DIMENSIONS.length in app.js.
{
  const m = appJs.match(/const DIMENSIONS = \[(.*?)\];/s);
  if (!m) {
    failures.push(
      "app.js: could not find `const DIMENSIONS = [...]` at all (may have been renamed; update this check's regex).",
    );
  } else {
    const items = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const realCount = items.length;

    const statMatch = about.match(
      /<div class="stat-tile__num">(\d+)<\/div><div class="stat-tile__label">scored dimensions<\/div>/,
    );
    if (!statMatch) {
      failures.push(
        'about.html: could not find the "scored dimensions" stat tile at all (markup may have changed; update this check\'s regex).',
      );
    } else {
      const shownCount = Number(statMatch[1]);
      if (shownCount !== realCount) {
        failures.push(
          `about.html says "${shownCount} scored dimensions" but app.js's DIMENSIONS array has ${realCount} entries (${items.join(", ")}). ` +
            `Update about.html's stat tile, or this check, whichever is actually stale.`,
        );
      }
    }
  }
}

// Check 2: "N weighted priorities" matches the number of top-level keys in
// PRIORITY_WEIGHTS. Each entry is a 2-space-indented key (bare word or
// quoted string) followed by a colon and an inline object, e.g.
//   Cheapest:                 { Cost: 1.0, ... },
//   "Best Value":              { Cost: 0.6, ... },
// The nested Cost/Comfort/etc. keys live inline on the same line, not on
// their own indented line, so this pattern only ever matches the top-level
// priority names, never a nested dimension key.
{
  const block = appJs.match(/const PRIORITY_WEIGHTS = \{([\s\S]*?)\n\};/);
  if (!block) {
    failures.push(
      "app.js: could not find `const PRIORITY_WEIGHTS = {...}` at all (may have been renamed; update this check's regex).",
    );
  } else {
    const entryPattern = /^  (?:"[^"]+"|[A-Za-z][\w ]*):\s*\{/gm;
    const items = block[1].match(entryPattern) || [];
    const realCount = items.length;

    const statMatch = about.match(
      /<div class="stat-tile__num">(\d+)<\/div><div class="stat-tile__label">weighted priorities<\/div>/,
    );
    if (!statMatch) {
      failures.push(
        'about.html: could not find the "weighted priorities" stat tile at all (markup may have changed; update this check\'s regex).',
      );
    } else {
      const shownCount = Number(statMatch[1]);
      if (shownCount !== realCount) {
        failures.push(
          `about.html says "${shownCount} weighted priorities" but app.js's PRIORITY_WEIGHTS object has ${realCount} top-level entries. ` +
            `Update about.html's stat tile, or this check, whichever is actually stale.`,
        );
      }
    }
  }
}

if (failures.length) {
  console.error("Content drift check FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
} else {
  console.log(
    "Content drift check passed: about.html's dimension/priority counts match app.js.",
  );
}
