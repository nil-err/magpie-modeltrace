// The fingerprint bank: what it covers, and how a model id maps to it.
//
// This module is environment-agnostic — no node builtins, no network — so the
// same code runs in a browser, in node, and in magpie's plugin host. The bank
// itself is fetched by whoever knows where it is: `loadBank` here for the web
// app (bank.json beside the page), `lib/bank-node.mjs` for a filesystem.

export const BANK_URL = "./bank.json";

let cached = null;

/** Whether an object is a ModelTrace bank, so a bad fetch fails loudly. */
export function isBank(value) {
  return Boolean(
    value &&
      Array.isArray(value.models) &&
      value.models.length &&
      value.robust?.hellinger &&
      value.calibration,
  );
}

/**
 * The bank, fetched once and kept.
 *
 * @param {string} [url] where it is served
 * @param {typeof fetch} [fetchImpl]
 */
export async function loadBank(url = BANK_URL, fetchImpl = fetch) {
  if (cached) return cached;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const bank = await response.json();
  if (!isBank(bank)) throw new Error(`${url} is not a ModelTrace bank`);
  cached = bank;
  return cached;
}

/** The bank a caller already has; a bank is required, never fetched here. */
export function requireBank(bank) {
  if (!isBank(bank)) throw new Error("a ModelTrace bank is required");
  return bank;
}

/**
 * What the bank covers, in the shape the page reports it: the models by id,
 * with their display names and families.
 */
export function bankSummary(bank) {
  requireBank(bank);
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

/** Whether a model id (as a gateway serves it, "provider/model") is in the bank. */
export function inBank(model, bank) {
  requireBank(bank);
  const bare = String(model || "").split("/").pop();
  return bank.models.some((entry) => entry.id === bare || entry.id === model);
}

/** The bank's id for a model as a gateway names it, or "" when it isn't one. */
export function bankIdOf(model, bank) {
  requireBank(bank);
  const bare = String(model || "").split("/").pop();
  const hit = bank.models.find((entry) => entry.id === model) || bank.models.find((entry) => entry.id === bare);
  return hit ? hit.id : "";
}

/** Drop leading `provider/` from a model list meant for `exclude`. */
export function normalizeExclude(list, bank) {
  requireBank(bank);
  return (list || []).map((model) => bankIdOf(model, bank) || String(model).split("/").pop());
}
