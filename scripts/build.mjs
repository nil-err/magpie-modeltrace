// Build the deployable site into dist/.
//
// No bundler and no dependencies: the page is a handful of ES modules the
// browser loads as they are, the bank is copied beside them, and the bank's
// provenance is checked on the way through. What is deployed is exactly what
// is in the repository — nothing is generated that a reviewer can't read.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const BANK = path.join(ROOT, "data", "unified_bank.json");
const PROVENANCE = path.join(ROOT, "data", "provenance.json");

/** Everything the site serves, as [from, to] under dist/. */
const FILES = [
  ["web/index.html", "index.html"],
  ["web/app.js", "app.js"],
  ["web/style.css", "style.css"],
  ["web/settings.js", "settings.js"],
  ["web/runner.js", "runner.js"],
  ["web/render.js", "render.js"],
  ["web/gateway.js", "gateway.js"],
  ["web/_worker.js", "_worker.js"],
  ["lib/bank.mjs", "lib/bank.mjs"],
  ["lib/challenges.mjs", "lib/challenges.mjs"],
  ["lib/fingerprint.mjs", "lib/fingerprint.mjs"],
  ["lib/probe.mjs", "lib/probe.mjs"],
  ["lib/report.mjs", "lib/report.mjs"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["LICENSE", "LICENSE"],
];

function checkBank() {
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
  const bytes = fs.readFileSync(BANK);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== provenance.bank.sha256) {
    throw new Error(`data/unified_bank.json is ${hash}, provenance says ${provenance.bank.sha256}`);
  }
  return { provenance, bytes };
}

function main() {
  const { provenance, bytes } = checkBank();

  fs.rmSync(DIST, { recursive: true, force: true });
  for (const [from, to] of FILES) {
    const source = path.join(ROOT, from);
    if (!fs.existsSync(source)) throw new Error(`${from} is missing`);
    const target = path.join(DIST, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  // The bank the page fetches. Copied verbatim, so the hash above is what is
  // served.
  fs.writeFileSync(path.join(DIST, "bank.json"), bytes);

  // The bank's own record travels with it: what it is, and what it hashed to.
  fs.writeFileSync(
    path.join(DIST, "bank-provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );

  // Cloudflare Pages serves an unknown path as 404 unless it is told
  // otherwise; this is a one-page app.
  fs.writeFileSync(
    path.join(DIST, "_headers"),
    [
      "/*",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: no-referrer",
      "  Permissions-Policy: geolocation=(), microphone=(), camera=()",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(DIST, "_redirects"), "/*  /index.html  200\n");

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push([path.relative(DIST, full), fs.statSync(full).size]);
    }
  };
  walk(DIST);
  files.sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`dist/ built from bank ${provenance.bank.built_at} (${provenance.bank.models} models)`);
  for (const [name, size] of files) console.log(`  ${String(size).padStart(8)}  ${name}`);
  const total = files.reduce((sum, [, size]) => sum + size, 0);
  console.log(`  ${String(total).padStart(8)}  total`);
}

main();
