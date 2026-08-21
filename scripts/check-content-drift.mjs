#!/usr/bin/env node
// Content-drift check for Travel Intelligence, same idea as Streaming Scout's
// scripts/check-content-drift.mjs (2026-08-08): about.html's "7 scored
// dimensions" / "7 weighted priorities" stat tiles are hand-typed numbers
// that describe app.js's own DIMENSIONS array and PRIORITY_WEIGHTS object.
// Nothing enforced them staying in sync until now, this fails loudly if a
// future edit adds/removes a dimension or a priority lens in app.js without
// updating the about.html copy that quotes the count.
//
// Add a new check here whenever a future session catches a new instance of
// "the page said X but the code said Y" by hand, so it stops needing to be
// caught by hand.

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

let failures = [];

const appJs = readFileSync("app.js", "utf8");
const about = readFileSync("about.html", "utf8");
const guide = readFileSync("guide.html", "utf8");
const roadmap = readFileSync("roadmap.html", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const watchMjs = readFileSync("netlify/functions/watch.mjs", "utf8");
const watchCheckMjs = readFileSync("netlify/functions/watch-check.mjs", "utf8");
const concertCheckMjs = readFileSync("netlify/functions/concert-match-check.mjs", "utf8");

// app.js is a browser script: give it a window, then read the object it
// attaches, exactly the way tests/app.test.js loads it. Nothing here
// touches the DOM or the network.
const require = createRequire(import.meta.url);
global.window = {};
require(process.cwd() + "/app.js");
const T = global.window.TravelIntel;

const PAGES = [["guide.html", guide], ["about.html", about], ["roadmap.html", roadmap]];

const WORD_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const toNum = (w) => (/^\d+$/.test(w) ? Number(w) : WORD_NUM[w.toLowerCase()]);

// Prose -> clauses. Tags become newlines so a list item, an SVG <text>
// line, and a sentence are all separate units; then split on sentence
// punctuation and on ", and "-style joins, because one sentence on these
// pages routinely describes two different scheduled jobs at once.
function clausesOf(html) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'");
  return text
    .split(/[.;:\n]+|,\s+(?:and|plus|then|but|so)\s+/)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

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

// ---------------------------------------------------------------------
// Checks 3-7 added 2026-08-21, after a hand-audit turned up five more
// instances of "the page said X but the code said Y" in one pass: two
// transfer bonuses that expired on Jul 31 still rendering under "Active
// transfer bonuses", a valuations table with no machine-readable copy
// date, a "daily" watcher cadence that has been every-other-day since
// 2026-08-11, an SVG caption claiming two backend functions when there
// are six, and a stat tile printing the MAX_TRIPS cap as if it were a
// live count.
// ---------------------------------------------------------------------

// Check 3: no expired transfer bonus can reach the screen, and the
// render path still goes through the filter that guarantees it.
{
  if (!T || typeof T.activeTransferBonuses !== "function") {
    failures.push(
      "app.js: window.TravelIntel.activeTransferBonuses is missing (renamed or no longer exported). The points panel needs it to keep expired bonuses off the screen; update this check or restore the export.",
    );
  } else {
    const now = Date.now();
    for (const b of T.activeTransferBonuses()) {
      const end = T.parseBonusEnd(b.ends);
      if (end !== null && end < now) {
        failures.push(
          `app.js: the transfer bonus "${b.from} -> ${b.to}" ends ${b.ends}, which has passed, but activeTransferBonuses() still returns it, so it renders under "Active transfer bonuses". Fix the filter in app.js.`,
        );
      }
    }
    for (const b of T.TRANSFER_BONUSES) {
      if (T.parseBonusEnd(b.ends) === null) {
        failures.push(
          `app.js: transfer bonus "${b.from} -> ${b.to}" has an end date of "${b.ends}", which parseBonusEnd can't read, so its expiry can never be checked and it will render forever. Write it in the "Jul 31, 2026" form the rest of the table uses.`,
        );
      }
    }
    if (/T\.TRANSFER_BONUSES\s*\.?\s*\n?\s*\.map\(/.test(indexHtml)) {
      failures.push(
        "index.html: the points panel maps over T.TRANSFER_BONUSES directly again. That is the raw table, expired rows included; render T.activeTransferBonuses() instead.",
      );
    }
  }
}

// Check 4: the hand-copied TPG valuations table has to be re-copied on
// something close to the monthly cadence the page claims for it.
{
  if (!T || !T.POINT_VALUATIONS || !T.POINT_VALUATIONS.copiedOn) {
    failures.push(
      "app.js: POINT_VALUATIONS.copiedOn is missing. It is the machine-readable half of the asOf string and the only thing that makes this staleness check possible; restore it.",
    );
  } else {
    const V = T.POINT_VALUATIONS;
    if (!V.asOf.includes(V.copiedOn)) {
      failures.push(
        `app.js: POINT_VALUATIONS.asOf ("${V.asOf}") no longer contains copiedOn ("${V.copiedOn}"). The prose date and the machine date have drifted apart; make them the same day.`,
      );
    }
    const age = T.valuationAge();
    if (age.stale) {
      failures.push(
        `app.js: POINT_VALUATIONS was hand-copied on ${V.copiedOn}, ${age.days} days ago, past the ${V.staleAfterDays}-day limit it sets for itself against a stated monthly refresh. Re-copy the figures from thepointsguy.com/loyalty-programs/monthly-valuations/ and update BOTH asOf and copiedOn.`,
      );
    }
  }
}

// Check 5: "N small functions" in prose vs. what is actually deployed.
{
  const real = readdirSync("netlify/functions", { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => e.name);
  const claim = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+small\s+(?:server\s+)?(?:functions?|pieces\s+of\s+server\s+code)\b/gi;
  let sawOne = false;
  for (const [name, html] of PAGES) {
    for (const m of html.matchAll(claim)) {
      sawOne = true;
      const said = toNum(m[1]);
      if (said !== real.length) {
        failures.push(
          `${name} says "${m[0]}" but netlify/functions holds ${real.length} (${real.join(", ")}). Update the prose, or this check if a function was added or removed on purpose.`,
        );
      }
    }
  }
  if (!sawOne) {
    failures.push(
      'guide.html/about.html: the "N small functions" backend claim has vanished from all three pages (wording may have changed; update this check\'s regex).',
    );
  }
}

// Check 6: every cadence word that describes a scheduled job, against
// the real crons. The fare watcher's cron fires daily but each trip has
// a ~44h floor in watch-check.mjs, so what a reader experiences is
// every-other-day; the cadence in prose has to match the floor, not the
// cron. concert-match-check.mjs is a genuine weekly cron.
{
  const floorMatch = watchCheckMjs.match(/now - last < (\d+) \* 3600 \* 1000/);
  const watchCron = watchCheckMjs.match(/export const config = \{ schedule: "([^"]+)" \}/);
  const concertCron = concertCheckMjs.match(/export const config = \{ schedule: "([^"]+)" \}/);

  if (!floorMatch || !watchCron) {
    failures.push(
      "netlify/functions/watch-check.mjs: could not read its re-check floor or its cron (code may have been restructured; update this check's regex). Nothing can verify the cadence the pages claim until it can.",
    );
  } else if (!concertCron) {
    failures.push(
      "netlify/functions/concert-match-check.mjs: could not read its cron (update this check's regex).",
    );
  } else {
    const floorHours = Number(floorMatch[1]);
    const watchCadence = floorHours >= 36 ? "every other day" : "daily";
    const concertWeekly = /^\S+ \S+ \* \* [0-6]$/.test(concertCron[1]);
    if (!concertWeekly) {
      failures.push(
        `netlify/functions/concert-match-check.mjs runs on "${concertCron[1]}", which is no longer a once-a-week schedule, but guide.html and about.html both call it a weekly sweep. Update the pages and this check together.`,
      );
    }
    // Cadence vocabulary. "monthly" is dropped from a clause that is
    // talking about the SerpApi quota rather than a schedule, which is a
    // real monthly number and not a cadence claim.
    const CADENCE = [
      ["every other day", /every[- ]other[- ]day/i],
      ["daily", /\bdail(?:y)\b|\beach day\b|\bevery day\b|\bper day\b/i],
      ["weekly", /\bweekly\b|\bonce a week\b/i],
      ["monthly", /\bmonthly\b|\beach month\b|\bevery month\b/i],
    ];
    const CONCERT = /concert|radar|vinyl\s*scout|\bshows?\b|matching/i;
    const WATCHER = /\bwatch(?:er|ed|es|ing)?\b|re-?check|re-?search/i;

    for (const [name, html] of PAGES) {
      for (const clause of clausesOf(html)) {
        let found = CADENCE.filter(([, re]) => re.test(clause)).map(([label]) => label);
        if (/quota/i.test(clause)) found = found.filter((f) => f !== "monthly");
        if (!found.length) continue;
        const isConcert = CONCERT.test(clause);
        const isWatcher = !isConcert && WATCHER.test(clause);
        if (!isConcert && !isWatcher) continue; // not describing a scheduled job
        const expected = isConcert ? "weekly" : watchCadence;
        const wrong = found.filter((f) => f !== expected);
        if (wrong.length) {
          const why = isConcert
            ? `concert-match-check.mjs runs on "${concertCron[1]}", i.e. weekly`
            : `watch-check.mjs fires on "${watchCron[1]}" but re-checks each trip at most once per ${floorHours}h, i.e. ${watchCadence}`;
          failures.push(
            `${name} describes a scheduled job as "${wrong.join('"/"')}" here: "${clause}". ${why}. Say "${expected}", or change the schedule.`,
          );
        }
      }
    }
  }
}

// Check 7: the watched-trip cap, on the stat tile and in prose, vs.
// MAX_TRIPS in watch.mjs (the single source of truth for it).
{
  const m = watchMjs.match(/export const MAX_TRIPS = (\d+);/);
  if (!m) {
    failures.push(
      "netlify/functions/watch.mjs: could not find `export const MAX_TRIPS = N;` (may have been renamed; update this check's regex).",
    );
  } else {
    const cap = Number(m[1]);
    const tile = about.match(
      /<div class="stat-tile__num">(\d+)<\/div><div class="stat-tile__label">watched-trip slots<\/div>/,
    );
    if (!tile) {
      failures.push(
        'about.html: could not find the "watched-trip slots" stat tile (markup or label may have changed; update this check\'s regex). That tile prints the MAX_TRIPS cap, so its label must keep saying "slots" and not imply a live count of trips.',
      );
    } else if (Number(tile[1]) !== cap) {
      failures.push(
        `about.html's stat tile says ${tile[1]} watched-trip slots but watch.mjs sets MAX_TRIPS = ${cap}. Update the tile.`,
      );
    }
    for (const [name, html] of PAGES) {
      for (const c of html.matchAll(/(?:capped at|holds up to)\s+([a-z0-9]+)\s+trips/gi)) {
        const said = toNum(c[1]);
        if (said !== cap) {
          failures.push(
            `${name} says "${c[0]}" but watch.mjs sets MAX_TRIPS = ${cap}. Update the prose.`,
          );
        }
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
    "Content drift check passed: dimension/priority counts, transfer-bonus expiry, valuation age, backend function count, scheduled-job cadences, and the watched-trip cap all match the code.",
  );
}
