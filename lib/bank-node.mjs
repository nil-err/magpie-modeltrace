// The bank off a filesystem: for the magpie plugin and the tests, which run
// where there is no URL to fetch. The browser gets its own loader in
// lib/bank.mjs, and both hand the same bank to the same maths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isBank } from "./bank.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BANK_PATH = path.join(HERE, "..", "data", "unified_bank.json");
export const PROVENANCE_PATH = path.join(HERE, "..", "data", "provenance.json");

let cached = null;

/** The bank as it ships on disk. Throws when it is missing or not a bank. */
export function loadBank() {
  if (cached) return cached;
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  if (!isBank(bank)) throw new Error(`${BANK_PATH} is not a ModelTrace bank`);
  cached = bank;
  return cached;
}

/** Where the shipped bank came from, and what it hashed to. */
export function provenance() {
  try {
    return JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8"));
  } catch {
    return null;
  }
}
