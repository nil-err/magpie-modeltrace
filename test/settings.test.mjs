// What the page remembers, and what it sends.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, loadSettings, parseHeaderLines, requestHeaders, saveSettings } from "../web/settings.js";

/** A localStorage stand-in with just the two calls the module makes. */
function fakeStorage(initial = null) {
  const store = new Map();
  if (initial !== null) store.set("modeltrace.settings.v1", initial);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    raw: store,
  };
}

test("a fresh browser gets the defaults", () => {
  assert.deepEqual(loadSettings(fakeStorage()), DEFAULTS);
});

test("what is saved comes back", () => {
  const storage = fakeStorage();
  saveSettings({ ...DEFAULTS, base: "https://g.example.com", key: "sk-1", selected: ["a/b"] }, storage);
  const back = loadSettings(storage);
  assert.equal(back.base, "https://g.example.com");
  assert.equal(back.key, "sk-1");
  assert.deepEqual(back.selected, ["a/b"]);
});

test("a corrupt blob falls back to the defaults instead of throwing", () => {
  assert.deepEqual(loadSettings(fakeStorage("{not json")), DEFAULTS);
});

test("an unknown field or a wrong type in storage is dropped", () => {
  const storage = fakeStorage(
    JSON.stringify({ base: "https://g", selected: ["a/b", 7], challenges: "many", nonsense: true }),
  );
  const back = loadSettings(storage);
  assert.equal(back.base, "https://g");
  assert.deepEqual(back.selected, ["a/b"]);
  assert.equal(back.challenges, DEFAULTS.challenges);
  assert.equal(back.nonsense, undefined);
});

test("numbers out of range are clamped, not trusted", () => {
  const storage = fakeStorage(JSON.stringify({ challenges: 99, concurrency: 0, timeoutSeconds: 5 }));
  const back = loadSettings(storage);
  assert.equal(back.challenges, 6);
  assert.equal(back.concurrency, 2, "0 is not a concurrency: it falls back to the default");
  assert.equal(back.timeoutSeconds, 10);
});

test("a key header that is not one of the three falls back to Authorization", () => {
  const storage = fakeStorage(JSON.stringify({ keyHeader: "cookie" }));
  assert.equal(loadSettings(storage).keyHeader, "authorization");
});

test("header lines are parsed, and a line without a colon is dropped", () => {
  const headers = parseHeaderLines("x-api-key: sk-1\nX-Title: modeltrace\n\nbroken line\n: no name\nempty:");
  assert.deepEqual(headers, { "x-api-key": "sk-1", "X-Title": "modeltrace" });
});

test("the key goes where the user said it goes", () => {
  const bearer = requestHeaders({ ...DEFAULTS, key: "sk-1", keyHeader: "authorization", headers: "X-Title: t" });
  assert.equal(bearer.Authorization, "Bearer sk-1");
  assert.equal(bearer["x-api-key"], undefined);
  assert.equal(bearer["X-Title"], "t");

  const xApiKey = requestHeaders({ ...DEFAULTS, key: "sk-2", keyHeader: "x-api-key" });
  assert.equal(xApiKey["x-api-key"], "sk-2");
  assert.equal(xApiKey.Authorization, undefined);

  const none = requestHeaders({ ...DEFAULTS, key: "sk-3", keyHeader: "none" });
  assert.equal(none.Authorization, undefined);
  assert.equal(none["x-api-key"], undefined);
});

test("an empty key sends no header at all", () => {
  assert.deepEqual(requestHeaders({ ...DEFAULTS, key: "   " }), {});
});
