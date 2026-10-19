// What the page remembers between visits.
//
// Everything lives in this browser's localStorage and nothing is sent anywhere
// but the gateway the user typed. The key is a secret, so it is only ever read
// back into the password field — never into a log, a URL or a report.

const STORAGE_KEY = "modeltrace.settings.v1";

export const DEFAULTS = {
  base: "",
  key: "",
  keyHeader: "authorization",
  headers: "",
  exclude: "",
  challenges: 3,
  parallel: true,
  concurrency: 2,
  timeoutSeconds: 120,
  selected: [],
  filter: "",
};

/** Only the fields we know, so an old or hand-edited blob can't inject one. */
function pick(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const field of Object.keys(DEFAULTS)) {
    if (raw[field] === undefined) continue;
    const expected = typeof DEFAULTS[field];
    if (typeof raw[field] === expected) out[field] = raw[field];
  }
  if (!Array.isArray(out.selected)) out.selected = [];
  out.selected = out.selected.filter((model) => typeof model === "string");
  out.challenges = Math.min(6, Math.max(1, Math.floor(Number(out.challenges) || 3)));
  out.concurrency = Math.min(8, Math.max(1, Math.floor(Number(out.concurrency) || 2)));
  out.timeoutSeconds = Math.min(600, Math.max(10, Math.floor(Number(out.timeoutSeconds) || 120)));
  if (!["authorization", "x-api-key", "none"].includes(out.keyHeader)) out.keyHeader = "authorization";
  return out;
}

export function loadSettings(storage = localStorage) {
  try {
    return pick(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return pick(null);
  }
}

export function saveSettings(settings, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(pick(settings)));
}

/**
 * The header lines the user typed, as an object.
 *
 * One per line, `Name: value`. A line without a colon is ignored rather than
 * guessed at — a silently mangled header is worse than a missing one.
 */
export function parseHeaderLines(text) {
  const headers = {};
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(":");
    if (at <= 0) continue;
    const name = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim();
    if (name && value) headers[name] = value;
  }
  return headers;
}

/** The headers a probe carries: the typed ones, plus the key in its place. */
export function requestHeaders(settings) {
  const headers = parseHeaderLines(settings.headers);
  const key = String(settings.key || "").trim();
  if (key && settings.keyHeader === "authorization") headers.Authorization = `Bearer ${key}`;
  if (key && settings.keyHeader === "x-api-key") headers["x-api-key"] = key;
  return headers;
}
