#!/usr/bin/env node
// Has ModelTrace's bank moved since the one this package ships?
//
// Compares the shipped data/unified_bank.json with upstream's, and reports what
// changed: new models, removed models, a newer built_at. Never writes anything
// unless you pass --write, because a new bank changes every score a user reads.
//
//   node scripts/sync-bank.mjs [--write] [--repo <path>]

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SHIPPED = path.join(ROOT, "data", "unified_bank.json");
const PROVENANCE = path.join(ROOT, "data", "provenance.json");
const UPSTREAM = "https://github.com/xqy2006/ModelTrace.git";

const has = (flag) => process.argv.includes(`--${flag}`);
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function upstreamRepo() {
  const given = arg("repo", "");
  if (given) return path.resolve(given);
  const cache = path.join(os.tmpdir(), "modeltrace-upstream");
  if (!fs.existsSync(path.join(cache, "data", "unified_bank.json"))) {
    console.log(`cloning ${UPSTREAM} into ${cache} …`);
    execFileSync("git", ["clone", "--depth", "1", UPSTREAM, cache], { stdio: "inherit" });
  } else {
    execFileSync("git", ["-C", cache, "pull", "--ff-only"], { stdio: "inherit" });
  }
  return cache;
}

function main() {
  const repo = upstreamRepo();
  const upstreamPath = path.join(repo, "data", "unified_bank.json");
  const upstreamBytes = fs.readFileSync(upstreamPath);
  const shippedBytes = fs.readFileSync(SHIPPED);
  const upstreamBank = JSON.parse(upstreamBytes.toString("utf8"));
  const shippedBank = JSON.parse(shippedBytes.toString("utf8"));

  const upstreamHash = sha256(upstreamBytes);
  const shippedHash = sha256(shippedBytes);
  console.log(`shipped  ${shippedBank.built_at}  ${shippedHash.slice(0, 16)}  ${shippedBank.models.length} models`);
  console.log(`upstream ${upstreamBank.built_at}  ${upstreamHash.slice(0, 16)}  ${upstreamBank.models.length} models`);

  if (upstreamHash === shippedHash) {
    console.log("\nidentical: nothing to do");
    return;
  }

  const shippedIds = shippedBank.models.map((model) => model.id);
  const upstreamIds = upstreamBank.models.map((model) => model.id);
  const added = upstreamIds.filter((id) => !shippedIds.includes(id));
  const removed = shippedIds.filter((id) => !upstreamIds.includes(id));
  const sameIds = added.length === 0 && removed.length === 0;
  if (added.length) console.log(`\nnew models upstream: ${added.join(", ")}`);
  if (removed.length) console.log(`\nmodels gone upstream: ${removed.join(", ")}`);
  if (sameIds) {
    console.log("\nsame models; the reference answers or the fit changed");
  }

  if (!has("write")) {
    console.log("\nnothing written. A new bank changes every score: re-run the tests, then --write if you mean it.");
    return;
  }

  const commit = (() => {
    try {
      return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();
  fs.copyFileSync(upstreamPath, SHIPPED);
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
  provenance.bank = {
    file: "unified_bank.json",
    sha256: upstreamHash,
    bytes: upstreamBytes.length,
    built_at: upstreamBank.built_at,
    models: upstreamBank.models.length,
  };
  provenance.source.commit = commit || provenance.source.commit;
  provenance.source.synced_at = new Date().toISOString();
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`\nwrote ${SHIPPED} and its provenance. Now: npm test`);
}

main();
