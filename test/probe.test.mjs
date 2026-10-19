// The probes: what is asked, and what is never taken for an answer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { askModel, collectAnswers } from "../lib/probe.mjs";

const challenge = { id: "c1", expected_count: 300, prompt: "give me 300 integers" };

/** A fetch stand-in: answers with `reply`, records what it was sent. */
function fakeFetch(reply, { status = 200, throws = null, body = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (throws) throw throws;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (body !== null) return body;
        return reply;
      },
    };
  };
  impl.calls = calls;
  return impl;
}

const chatReply = (content, extra = {}) => ({
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop", ...extra }],
  model: "some/thing",
});

test("a probe asks magpie's chat completions with the challenge as the only message", async () => {
  const fetchImpl = fakeFetch(chatReply("1 2 3"));
  const answer = await askModel({ base: "http://127.0.0.1:3425", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.ok, true);
  assert.equal(answer.text, "1 2 3");
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:3425/v1/chat/completions");
  assert.deepEqual(fetchImpl.calls[0].body.messages, [{ role: "user", content: "give me 300 integers" }]);
  assert.equal(fetchImpl.calls[0].body.model, "a/b");
  assert.equal(fetchImpl.calls[0].body.stream, false);
  // a list of 300 three-digit numbers must fit in max_tokens
  assert.ok(fetchImpl.calls[0].body.max_tokens >= 8000, "a thinking model needs room for its reasoning and the list");
});

test("a trailing slash on the gateway does not double up", async () => {
  const fetchImpl = fakeFetch(chatReply("1"));
  await askModel({ base: "http://127.0.0.1:3425/", model: "a/b", challenge, fetchImpl });
  assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:3425/v1/chat/completions");
});

test("content parts are joined, as a translated reply arrives that way", async () => {
  const fetchImpl = fakeFetch({
    choices: [{ message: { content: [{ type: "text", text: "1 2" }, { type: "text", text: "3" }] } }],
  });
  const answer = await askModel({ base: "http://x", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.text, "1 23");
});

test("an upstream error is a gap with its message, not an exception", async () => {
  const fetchImpl = fakeFetch({ error: { message: "You've hit your session limit" } }, { status: 429 });
  const answer = await askModel({ base: "http://x", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.ok, false);
  assert.equal(answer.status, 429);
  assert.match(answer.error, /session limit/);
  assert.equal(answer.text, "");
});

test("a reply that is not JSON is a gap that names the status", async () => {
  const fetchImpl = fakeFetch(null, { status: 502, body: undefined });
  const answer = await askModel({ base: "http://x", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /502/);
});

test("a network failure is a gap, not a crash", async () => {
  const fetchImpl = fakeFetch(null, { throws: new Error("ECONNREFUSED") });
  const answer = await askModel({ base: "http://x", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /ECONNREFUSED/);
});

test("a truncated answer is still returned — the scorer judges it", async () => {
  const fetchImpl = fakeFetch(chatReply("1 2 3", { finish_reason: "length" }));
  const answer = await askModel({ base: "http://x", model: "a/b", challenge, fetchImpl });
  assert.equal(answer.ok, true);
  assert.equal(answer.finish_reason, "length");
});

test("three challenges are asked at once and share one budget", async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight -= 1;
    return { status: 200, ok: true, json: async () => chatReply("1 2 3") };
  };
  const challenges = [
    { id: "a", expected_count: 300, prompt: "a" },
    { id: "b", expected_count: 301, prompt: "b" },
    { id: "c", expected_count: 302, prompt: "c" },
  ];
  const answers = await collectAnswers({
    base: "http://x",
    model: "a/b",
    challenges,
    budgetMs: 5000,
    fetchImpl,
  });
  assert.equal(answers.length, 3);
  assert.equal(peak, 3, "asked in parallel: three thinking models in a row never fit in 55s");
  assert.deepEqual(
    answers.map((answer) => answer.challenge.id),
    ["a", "b", "c"],
  );
});

test("the budget is a deadline: what misses it is a gap, not a hang", async () => {
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  const started = Date.now();
  const answers = await collectAnswers({
    base: "http://x",
    model: "a/b",
    challenges: [{ id: "a", expected_count: 300, prompt: "a" }],
    budgetMs: 120,
    fetchImpl,
  });
  assert.ok(Date.now() - started < 2000, "it returned at the budget");
  assert.equal(answers[0].ok, false);
  assert.match(answers[0].error, /budget/);
});

test("one at a time is available for an upstream that cannot take a burst", async () => {
  const order = [];
  const fetchImpl = async (url, init) => {
    order.push(JSON.parse(init.body).messages[0].content);
    return { status: 200, ok: true, json: async () => chatReply("1") };
  };
  const challenges = ["a", "b", "c"].map((id) => ({ id, expected_count: 300, prompt: id }));
  await collectAnswers({ base: "http://x", model: "m", challenges, budgetMs: 5000, parallel: false, fetchImpl });
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("an aborted outer signal stops the probes", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = async (url, init) => {
    if (init.signal.aborted) throw new Error("aborted");
    return { status: 200, ok: true, json: async () => chatReply("1") };
  };
  const answers = await collectAnswers({
    base: "http://x",
    model: "m",
    challenges: [{ id: "a", expected_count: 300, prompt: "a" }],
    budgetMs: 5000,
    fetchImpl,
    deadlineSignal: controller.signal,
  });
  assert.equal(answers[0].ok, false);
});
