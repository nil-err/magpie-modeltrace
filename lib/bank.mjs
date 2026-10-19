// The fingerprint bank, loaded once and kept.
//
// data/unified_bank.json is ModelTrace's own bank (MIT), copied as it ships:
// 18 models over two families, 36 reference answers each, fitted with the
// nuisance-Hellinger and ordered-block features. Its provenance — where it
// came from and what it hashed to — is in data/provenance.json, and
// scripts/sync-bank.mjs checks a newer one against it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BANK_PATH = path.join(HERE, "..", "data", "unified_bank.json");
export const PROVENANCE_PATH = path.join(HERE, "..", "data", "provenance.json");

let cached = null;

/** The bank as it ships. Throws when the file is missing or not a bank. */
export function loadBank() {
  if (cached) return cached;
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  if (!Array.isArray(bank.models) || !bank.models.length) throw new Error(`${BANK_PATH} has no models`);
  if (!bank.robust?.hellinger || !bank.calibration) throw new Error(`${BANK_PATH} is not a ModelTrace bank`);
  cached = bank;
  return cached;
}

export function provenance() {
  try {
    return JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * What the bank covers, in the shape the tools report it: the models by id,
 * with their display names and families, and whether an id is one of them.
 */
export function bankSummary(bank = loadBank()) {
  const families = [...new Set(bank.models.map((model) => model.family || "models"))].map((family) => ({
    family,
    display_name: bank.models.find((model) => (model.family || "models") === family)?.family_name || family,
    models: bank.models.filter((model) => (model.family || "models") === family).map((model) => model.id),
  }));
  return {
    built_at: bank.built_at,
    method: bank.method?.name ?? "",
    answers_per_model: bank.models[0]?.response_count ?? null,
    minimum_valid_numbers: bank.minimum_valid_numbers ?? 80,
    model_count: bank.models.length,
    models: bank.models.map((model) => ({
      id: model.id,
      display_name: model.display_name,
      family: model.family_name || model.family,
    })),
    families,
    calibration: Object.fromEntries(
      Object.entries(bank.calibration).map(([answers, cal]) => [
        answers,
        { cv_accuracy: cal.cv_accuracy, cv_samples: cal.cv_samples },
      ]),
    ),
  };
}

/** Whether a model id (as magpie serves it, "provider/model") is in the bank. */
export function inBank(model, bank = loadBank()) {
  const bare = String(model || "").split("/").pop();
  return bank.models.some((entry) => entry.id === bare || entry.id === model);
}

/** The bank's id for a model as magpie names it, or "" when it isn't one. */
export function bankIdOf(model, bank = loadBank()) {
  const bare = String(model || "").split("/").pop();
  const hit = bank.models.find((entry) => entry.id === model) || bank.models.find((entry) => entry.id === bare);
  return hit ? hit.id : "";
}

/** Drop leading `provider/` from a model list meant for `exclude`. */
export function normalizeExclude(list, bank = loadBank()) {
  return (list || []).map((model) => bankIdOf(model, bank) || String(model).split("/").pop());
}
