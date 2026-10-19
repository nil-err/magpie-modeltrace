#!/usr/bin/env node
// Is this port still the same scorer as ModelTrace's?
//
// Clones (or reuses) xqy2006/ModelTrace, runs its static/fingerprint-core.js and
// lib/fingerprint.mjs over the same answers, and compares every candidate's
// probability — not only the winner's, because a drift that leaves the order
// alone still changes the numbers a user reads.
//
//   node scripts/verify-parity.mjs [--repo <path>] [--answers <n>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { analyzeOutputs } from "../lib/fingerprint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const UPSTREAM = "https://github.com/xqy2006/ModelTrace.git";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function upstreamRepo() {
  const given = arg("repo", "");
  if (given) return path.resolve(given);
  const cache = path.join(os.tmpdir(), "modeltrace-upstream");
  if (!fs.existsSync(path.join(cache, "static", "fingerprint-core.js"))) {
    console.log(`cloning ${UPSTREAM} into ${cache} …`);
    execFileSync("git", ["clone", "--depth", "1", UPSTREAM, cache], { stdio: "inherit" });
  } else {
    console.log(`using the clone at ${cache}`);
  }
  return cache;
}

/** Every reference answer of a model, three at a time, as the bank groups them. */
function triples(repo, limit) {
  const rows = [];
  for (const file of ["gpt_reference.jsonl", "claude_reference.jsonl"]) {
    const full = path.join(repo, "data", file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.text && row.parsed_count >= 80) rows.push(row);
    }
  }
  const byModel = new Map();
  for (const row of rows) {
    if (!byModel.has(row.model_id)) byModel.set(row.model_id, []);
    byModel.get(row.model_id).push(row);
  }
  const out = [];
  for (const [model, list] of byModel) {
    for (let index = 0; index + 2 < list.length; index += 3) {
      if (out.length >= limit) return out;
      out.push({
        model,
        answers: list.slice(index, index + 3).map((row) => ({
          text: row.text,
          expected_count: row.requested_count,
        })),
      });
    }
  }
  return out;
}

async function main() {
  const repo = upstreamRepo();
  const theirBankPath = path.join(repo, "data", "unified_bank.json");
  if (!fs.existsSync(theirBankPath)) throw new Error(`${theirBankPath} is not there — is ${repo} a ModelTrace clone?`);
  const theirBank = JSON.parse(fs.readFileSync(theirBankPath, "utf8"));
  const ourBank = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "unified_bank.json"), "utf8"));
  if (JSON.stringify(theirBank.models) !== JSON.stringify(ourBank.models)) {
    console.log("! upstream's bank has different models from the one this package ships");
  }
  const upstream = await import(pathToFileURL(path.join(repo, "static", "fingerprint-core.js")).href);

  const limit = Number(arg("answers", 240));
  const cases = triples(repo, limit);
  if (!cases.length) throw new Error("no reference answers to compare — check the clone's data/ folder");
  console.log(`comparing ${cases.length} triples`);

  let worst = 0;
  let agreed = 0;
  let mismatched = 0;
  for (const item of cases) {
    const answers = item.answers.map((answer) => ({ ...answer }));
    const theirs = upstream.analyzeGlobalOutputs(answers.map((answer) => ({ ...answer })), theirBank);
    const ours = analyzeOutputs(answers.map((answer) => ({ ...answer })), ourBank);
    if (theirs.prediction !== ours.prediction) {
      mismatched += 1;
      console.log(`MISMATCH ${item.model}: theirs ${theirs.prediction}, ours ${ours.prediction}`);
    } else {
      agreed += 1;
    }
    for (const candidate of theirs.results) {
      const mine = ours.results.find((entry) => entry.model === candidate.model);
      const diff = mine ? Math.abs(mine.probability - candidate.probability) : 1;
      worst = Math.max(worst, diff);
    }
  }
  console.log(`agreed ${agreed}/${cases.length} triples, ${mismatched} mismatched, worst probability difference ${worst}`);
  if (mismatched || worst > 1e-9) {
    console.error("the port has drifted from ModelTrace's scorer");
    process.exit(1);
  }
  console.log("the port is identical to ModelTrace's scorer on every answer compared");
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
