#!/usr/bin/env node
// scripts/check-deploy-fresh.mjs
//
// Is the LIVE site actually serving what this repo says it should?
//
// Written 2026-08-21, after vinylscout.org spent 8 days frozen on a deploy from
// 2026-08-14. Every push succeeded, every build setting looked right, and the
// published deploy carried `locked: true` — Netlify pins a locked deploy as the
// live one, so builds ran and nothing ever published over it. Nothing noticed,
// because every check in this portfolio watches whether DATA is fresh. Nothing
// watched whether the deployed SITE matches the repo.
//
// The method needs no credential and no build step, which is the point. These
// sites publish the repo root as-is (publish = "."), so a page served live
// should be byte-identical to the same file on disk at the deployed commit.
// Fetch it, hash both, compare.
//
// It deliberately does NOT ask Netlify's API. An API answer of "ready" is what
// made this invisible for 8 days: the deploy WAS ready, it just wasn't the one
// being served. The only trustworthy check reads what a visitor reads.
//
// Network-dependent, so it is NOT in `npm test` — that suite is offline and
// deterministic by design. Run it after deploying, or from a scheduled task.
//
// Usage:
//   node scripts/check-deploy-fresh.mjs           check, exit 1 on drift
//   node scripts/check-deploy-fresh.mjs --wait    poll 3 min (use right after a push)
//   node scripts/check-deploy-fresh.mjs --json    machine-readable

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CONFIG_PATH = join(HERE, "deploy-fresh.config.json");

const args = process.argv.slice(2);
const WAIT = args.includes("--wait");
const JSON_OUT = args.includes("--json");
const WAIT_TOTAL_MS = 3 * 60 * 1000;
const WAIT_INTERVAL_MS = 15 * 1000;

if (!existsSync(CONFIG_PATH)) {
  console.error("Missing " + CONFIG_PATH + '. Expected: { "baseUrl": "https://example.org", "files": ["about.html"] }');
  process.exit(1);
}
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
const files = Array.isArray(config.files) ? config.files : [];
if (!baseUrl || files.length === 0) {
  console.error(CONFIG_PATH + " needs a baseUrl and a non-empty files array.");
  process.exit(1);
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

// Normalise before hashing. A trailing-newline or CRLF difference in a working
// copy is not a deploy problem, and a check that cries wolf gets ignored inside
// a month.
const normalise = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";

async function fetchLive(file) {
  // Always ask for an uncached copy: a stale CDN edge is part of the bug class
  // this exists to catch, and we want it distinguishable from a stale deploy.
  const url = baseUrl + "/" + file + "?deployfresh=" + Date.now();
  const res = await fetch(url, {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return await res.text();
}

async function runOnce() {
  const results = [];
  for (const file of files) {
    const localPath = join(ROOT, file);
    if (!existsSync(localPath)) {
      results.push({ file, status: "missing-locally", detail: file + " is in the config but not in the repo" });
      continue;
    }
    const local = normalise(readFileSync(localPath, "utf8"));
    let live;
    try {
      live = normalise(await fetchLive(file));
    } catch (err) {
      results.push({ file, status: "unreachable", detail: err.message });
      continue;
    }
    const localSha = sha(local), liveSha = sha(live);
    results.push({
      file,
      status: localSha === liveSha ? "match" : "drift",
      localSha, liveSha,
      localBytes: local.length, liveBytes: live.length,
    });
  }
  return results;
}

function report(results) {
  const drift = results.filter((r) => r.status === "drift");
  const broken = results.filter((r) => r.status === "unreachable" || r.status === "missing-locally");
  const ok = results.filter((r) => r.status === "match");

  if (JSON_OUT) {
    console.log(JSON.stringify({ baseUrl, results, ok: !drift.length && !broken.length }, null, 2));
    return !drift.length && !broken.length;
  }
  if (!drift.length && !broken.length) {
    console.log("Deploy freshness check passed: " + baseUrl + " is serving the same bytes this repo holds for " + ok.length + " page" + (ok.length === 1 ? "" : "s") + " (" + files.join(", ") + ").");
    return true;
  }

  console.error("\nDeploy freshness check FAILED for " + baseUrl + "\n");
  for (const r of broken) console.error("  " + r.file + ": " + r.status + " — " + r.detail);
  for (const r of drift) {
    console.error("  " + r.file + ": LIVE DOES NOT MATCH THIS REPO");
    console.error("      repo " + r.localSha + " (" + r.localBytes + " bytes)   live " + r.liveSha + " (" + r.liveBytes + " bytes)");
  }
  if (drift.length) {
    console.error([
      "",
      "The live site is not serving this commit. In order of likelihood:",
      "",
      "  1. The published deploy is LOCKED. Netlify pins a locked deploy as the live",
      "     one; builds still run and never publish over it. This froze vinylscout.org",
      "     for 8 days in August 2026.",
      "     app.netlify.com/projects/<project>/deploys -> find Locked -> Unlock ->",
      "     Trigger deploy.",
      "",
      "  2. Auto-publishing is off in Build & deploy, with nothing publishing instead.",
      "",
      "  3. The push has not landed:",
      "       git rev-parse HEAD   vs   git ls-remote origin refs/heads/main",
      "",
      "  4. The deploy is still building. Re-run with --wait.",
      "",
      "  5. netlify-ignore.sh skipped the build because no watched path changed.",
      "     Legitimate for a docs-only commit; check its watched list.",
      "",
    ].join("\n"));
  }
  return false;
}

let results = await runOnce();
if (WAIT && results.some((r) => r.status === "drift" || r.status === "unreachable")) {
  const deadline = Date.now() + WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    console.log("Live site does not match yet; deploy may still be building. Retrying (" + Math.round((deadline - Date.now()) / 1000) + "s left)...");
    await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
    results = await runOnce();
    if (!results.some((r) => r.status === "drift" || r.status === "unreachable")) break;
  }
}
process.exit(report(results) ? 0 : 1);
