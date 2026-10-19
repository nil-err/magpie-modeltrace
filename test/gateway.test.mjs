// The page's gateway calls: what is asked, and how a failure is told apart.

import { test } from "node:test";
import assert from "node:assert/strict";

import { describeNetworkError, fetchModels, probeModel } from "../web/gateway.js";
import { chatEndpoint, probeHeaders } from "../lib/probe.mjs";

/** A fetch stand-in that answers with `reply` and records the calls. */
function fakeFetch(reply, { status = 200, throws = null } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (throws) throw throws;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  };
  impl.calls = calls;
  return impl;
}

test("a base URL gets /v1/chat/completions", () => {
  assert.equal(chatEndpoint("https://g.example.com"), "https://g.example.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://g.example.com/"), "https://g.example.com/v1/chat/completions");
});

test("a base URL that already ends in /v1 is not doubled", () => {
  assert.equal(chatEndpoint("https://g.example.com/v1"), "https://g.example.com/v1/chat/completions");
});

test("a full endpoint URL is taken as it is", () => {
  assert.equal(
    chatEndpoint("https://g.example.com/v1/chat/completions"),
    "https://g.example.com/v1/chat/completions",
  );
});

test("headers are lower-cased and empty ones are left out", () => {
  assert.deepEqual(probeHeaders({ Authorization: "Bearer k", "x-empty": "" }), {
    "content-type": "application/json",
    authorization: "Bearer k",
  });
});

test("the model list is read from data[] and sorted", async () => {
  const impl = fakeFetch({ data: [{ id: "b/model" }, { id: "a/model" }, { id: "a/model" }] });
  const models = await fetchModels({ base: "https://g.example.com", headers: { Authorization: "Bearer k" }, fetchImpl: impl });
  assert.deepEqual(models, ["a/model", "a/model", "b/model"]);
});

test("the model list strips a /v1 base down to /v1/models", async () => {
  const impl = fakeFetch({ data: [] });
  await fetchModels({ base: "https://g.example.com/v1/", fetchImpl: impl });
  assert.equal(impl.calls[0].url, "https://g.example.com/v1/models");
});

test("an OpenAI-shaped error body is quoted back", async () => {
  const impl = fakeFetch({ error: { message: "invalid api key" } }, { status: 401 });
  await assert.rejects(
    fetchModels({ base: "https://g.example.com", fetchImpl: impl }),
    /401.*invalid api key/,
  );
});

test("a CORS failure is explained, not just repeated", async () => {
  const impl = fakeFetch(null, { throws: new TypeError("Failed to fetch") });
  await assert.rejects(fetchModels({ base: "https://g.example.com", fetchImpl: impl }), /CORS/);
});

test("a timeout says so, with the URL", () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  assert.match(describeNetworkError(error, "https://g/v1/chat/completions"), /超时.*https:\/\/g/);
});

test("a probe sends the challenge and reads the answer", async () => {
  const impl = fakeFetch({ choices: [{ message: { content: "1 2 3" }, finish_reason: "stop" }], model: "a/b" });
  const result = await probeModel({
    base: "https://g.example.com",
    model: "a/b",
    challenges: [{ id: "c1", expected_count: 300, prompt: "give 300" }],
    headers: { Authorization: "Bearer k" },
    timeoutMs: 5000,
    parallel: true,
    fetchImpl: impl,
  });
  assert.equal(result.error, null);
  assert.equal(result.answers.length, 1);
  assert.equal(result.answers[0].text, "1 2 3");
  assert.equal(impl.calls[0].url, "https://g.example.com/v1/chat/completions");
  assert.equal(impl.calls[0].init.headers.authorization, "Bearer k");
});

test("a probe that times out is a result, not a thrown batch", async () => {
  const impl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  const result = await probeModel({
    base: "https://g.example.com",
    model: "a/b",
    challenges: [{ id: "c1", expected_count: 300, prompt: "give 300" }],
    headers: {},
    timeoutMs: 60,
    parallel: true,
    fetchImpl: impl,
  });
  assert.equal(result.answers[0].ok, false);
  assert.match(result.answers[0].error, /budget/);
});
