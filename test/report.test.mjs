// The report: what a person reads, and the caveats that must never be lost.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBank } from "../lib/bank.mjs";
import { attribute, caveats, reportText, summaryLine } from "../lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bank = loadBank();
const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "reference-answers.json"), "utf8"));
const triple = fixtures.find((fixture) => fixture.used_outputs === 3);

const answersFrom = (fixture) =>
  fixture.answers.map((answer, index) => ({
    challenge: { id: `c${index}`, expected_count: answer.expected_count, prompt: "" },
    ok: true,
    text: answer.text,
    model_asked: "relay/suspect-model",
    model: "suspect-model",
    ms: 1200,
  }));

test("a scored run says the model, the probability, the family and the gaps", () => {
  const result = attribute({ answers: answersFrom(triple), bank, exclude: [] });
  assert.equal(result.scored, true);
  assert.equal(result.used_outputs, 3);
  assert.equal(result.asked_model, "relay/suspect-model");
  // the plugin never claims the model it was asked about is the answer
  assert.equal(result.expected_model_in_bank, null, "relay/suspect-model is not a bank label");
  const line = summaryLine(result);
  assert.match(line, /relay\/suspect-model looks most like/);
  assert.match(line, /3\/3 answers scored/);
});

test("a model the bank holds is named as such", () => {
  const answers = answersFrom(triple);
  answers.forEach((answer) => {
    answer.model_asked = "claude/claude-opus-5-5";
  });
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.expected_model_in_bank, "claude-opus-5-5");
  // and the report does not tell the reader it is unknown
  assert.ok(!caveats(result, bank).some((line) => line.includes("is not one of the bank's labels")));
});

test("a gap is reported with the reason, and never scored", () => {
  const answers = answersFrom(triple);
  answers[1] = { ...answers[1], ok: false, text: "", error: "You've hit your session limit" };
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.scored, true);
  assert.equal(result.used_outputs, 2);
  assert.equal(result.diagnostics[1].accepted, false);
  assert.match(result.diagnostics[1].gap, /session limit/);
  assert.match(summaryLine(result), /2\/3 answers scored, 1 gap/);
  assert.ok(reportText(result, bank).includes("challenge 2: You've hit your session limit"));
  assert.ok(caveats(result, bank).some((line) => line.startsWith("Gaps:")));
});

test("an answer cut off at max_tokens is a gap, even when it parsed", () => {
  const answers = answersFrom(triple);
  answers[0] = { ...answers[0], finish_reason: "length" };
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.diagnostics[0].accepted, false);
  assert.match(result.diagnostics[0].gap, /cut off/);
});

test("a short answer is a gap that says how short", () => {
  const answers = answersFrom(triple);
  answers[2] = { ...answers[2], text: "1 2 3 4 5" };
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.diagnostics[2].accepted, false);
  assert.match(result.diagnostics[2].gap, /only 5 numbers came back/);
});

test("nothing scorable is an answer that says so, not an exception", () => {
  const answers = answersFrom(triple).map((answer) => ({ ...answer, ok: false, text: "", error: "rate limited" }));
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.scored, false);
  assert.equal(result.reason, "no answer could be scored");
  assert.equal(result.gaps.length, 3);
  const text = reportText(result, bank);
  assert.match(text, /could not score/);
  assert.match(text, /challenge 1: rate limited/);
});

test("the report always carries the closed-set caveat and the shared-context caveat", () => {
  const result = attribute({ answers: answersFrom(triple), bank, exclude: [] });
  const lines = caveats(result, bank);
  assert.ok(lines.some((line) => /Closed set/.test(line)));
  assert.ok(lines.some((line) => /system prompt/.test(line)));
  assert.ok(lines.some((line) => /share context/.test(line)));
  assert.ok(lines.some((line) => /not been measured/.test(line)));
  const text = reportText(result, bank);
  assert.match(text, /Read this as:/);
  for (const line of lines) assert.ok(text.includes(line), `missing caveat: ${line}`);
});

test("a run where the upstream reported different models is flagged", () => {
  const answers = answersFrom(triple);
  answers[1] = { ...answers[1], model: "something-else" };
  const result = attribute({ answers, bank, exclude: [] });
  assert.equal(result.self_consistent, false);
  assert.ok(caveats(result, bank).some((line) => /different model on different answers/.test(line)));
});

test("the report lists at most eight candidates and counts the rest", () => {
  const result = attribute({ answers: answersFrom(triple), bank, exclude: [] });
  const text = reportText(result, bank);
  assert.match(text, /Candidates:/);
  assert.match(text, /…and 10 more in the structured answer/);
  assert.equal(result.results.length, 18, "the structured answer still holds every candidate");
});

test("excluding a model is reflected in the structured answer", () => {
  const target = triple.prediction;
  const result = attribute({ answers: answersFrom(triple), bank, exclude: [target] });
  assert.notEqual(result.prediction, target);
  assert.ok(!result.results.some((item) => item.model === target));
});
