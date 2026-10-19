// The plugin as magpie loads it: the module's export, the three tools, the
// JSON Schema each declares, and the arguments magpie checks against it.
//
// magpie's host calls the module's default export (or every function it
// exports) with (input, options) and reads {tool} off what comes back; each
// tool needs a description and an `execute`. The schema checks below are the
// ones host.js does: a name of [A-Za-z0-9_-]{1,48} and a JSON Schema object.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ModelTracePlugin, _internal } from "../index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "reference-answers.json"), "utf8"));
const triple = fixtures.find((fixture) => fixture.used_outputs === 3);
const TOOL_NAME = /^[A-Za-z0-9_-]{1,48}$/;

test("the module exports a plugin function magpie can load", () => {
  assert.equal(typeof ModelTracePlugin, "function");
  const hooks = ModelTracePlugin({}, {});
  assert.ok(hooks && typeof hooks.then === "function", "may be async, as magpie allows");
});

test("the tools are named the way magpie's MCP server expects", async () => {
  const { tool } = await ModelTracePlugin({}, {});
  assert.deepEqual(Object.keys(tool).sort(), ["attribute", "challenge", "fingerprints"]);
  for (const [name, def] of Object.entries(tool)) {
    assert.match(name, TOOL_NAME);
    assert.ok(def.description.length > 80, `${name} needs a description an agent can act on`);
    assert.equal(typeof def.execute, "function");
    // magpie accepts a raw JSON Schema as well as a zod shape
    assert.equal(def.args.type, "object");
    assert.equal(typeof def.args.properties, "object");
  }
  // the MCP names magpie will give them: <short name>_<tool>
  for (const name of Object.keys(tool)) assert.ok(`modeltrace_${name}`.length <= 64);
});

test("fingerprints lists the bank without touching the network", async () => {
  const { tool } = await ModelTracePlugin({}, {});
  const answer = await tool.fingerprints.execute({}, {});
  assert.match(answer.output, /18 models/);
  assert.match(answer.output, /gpt-6-astra/);
  assert.match(answer.output, /claude-opus-5-5/);
  assert.equal(answer.model_count, 18);
  assert.equal(answer.models.length, 18);
  assert.equal(answer.families.length, 2);
  // the caveat travels with the list, not only with the attribution
  assert.match(answer.output, /not this probe's/);
});

test("challenge hands out three prompts and their expected counts", async () => {
  const { tool } = await ModelTracePlugin({}, {});
  const answer = await tool.challenge.execute({}, {});
  assert.equal(answer.challenges.length, 3);
  for (const [index, challenge] of answer.challenges.entries()) {
    assert.ok(challenge.expected_count >= 292 && challenge.expected_count <= 332);
    assert.ok(answer.output.includes(challenge.prompt));
    assert.ok(answer.output.includes(`challenge ${index + 1}`));
  }
});

test("attribute scores answers it is given, with no gateway in reach", async () => {
  const { tool } = await ModelTracePlugin({}, {});
  const answer = await tool.attribute.execute(
    {
      model: "relay/suspect",
      answers: triple.answers.map((item) => item.text),
      expected_counts: triple.answers.map((item) => item.expected_count),
    },
    {},
  );
  assert.equal(answer.scored, true);
  assert.equal(answer.prediction, triple.prediction);
  assert.equal(answer.candidates, 18);
  assert.match(answer.output, /looks most like/);
  assert.match(answer.output, /Closed set/);
});

test("attribute asks magpie's gateway when no answers are given", async () => {
  const asks = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    asks.push({ url, body: JSON.parse(init.body) });
    const text = triple.answers[asks.length - 1]?.text ?? triple.answers[0].text;
    return {
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], model: "suspect" }),
    };
  };
  try {
    const { tool } = await ModelTracePlugin({}, { gateway: "http://127.0.0.1:3425" });
    const answer = await tool.attribute.execute({ model: "relay/suspect" }, {});
    assert.equal(asks.length, 3);
    for (const ask of asks) {
      assert.equal(ask.url, "http://127.0.0.1:3425/v1/chat/completions");
      assert.equal(ask.body.model, "relay/suspect");
      // no key: magpie lets this computer's own calls in
      assert.equal(ask.body.stream, false);
    }
    assert.equal(answer.scored, true);
    assert.equal(answer.asked_model, "relay/suspect");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the plugin option `model` stands in for an argument that is left out", async () => {
  const { tool } = await ModelTracePlugin({}, { model: "from/option" });
  let askedModel = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    askedModel = JSON.parse(init.body).model;
    return {
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: triple.answers[0].text }, finish_reason: "stop" }] }),
    };
  };
  try {
    await tool.attribute.execute({}, {});
    assert.equal(askedModel, "from/option");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("naming no model at all is an error that says what to do", async () => {
  const { tool } = await ModelTracePlugin({}, {});
  await assert.rejects(() => tool.attribute.execute({}, {}), /name the model to test/);
});

test("the option `exclude` keeps a model out of the candidates", async () => {
  const { tool } = await ModelTracePlugin({}, { exclude: ["claude/claude-opus-5-5"] });
  const answer = await tool.attribute.execute(
    { answers: triple.answers.map((item) => item.text), expected_counts: triple.answers.map((item) => item.expected_count) },
    {},
  );
  assert.equal(answer.candidates, 17);
  assert.ok(!answer.results.some((item) => item.model === "claude-opus-5-5"), "provider/ prefix is stripped");
});

test("each load reads its options afresh", async () => {
  const first = await ModelTracePlugin({}, { model: "one/model" });
  const second = await ModelTracePlugin({}, { model: "two/model" });
  assert.notEqual(first.tool.attribute, second.tool.attribute, "the tools close over their own options");
  assert.equal(_internal.options({}).base, "http://127.0.0.1:3425");
  assert.equal(_internal.options({ gateway: "http://g:1/" }).base, "http://g:1/");
  assert.equal(_internal.options({ budgetMs: 900_000 }).budgetMs, 50_000, "capped under magpie's 55s tool timeout");
  assert.equal(_internal.options({ parallel: false }).parallel, false);
  assert.deepEqual(_internal.options({ exclude: ["a", 3, ""] }).exclude, ["a"]);
});
