// The maths has to stay identical to ModelTrace's own scorer: the bank's
// centroids, nuisance basis and calibration betas were fitted against this
// exact expression, so a "cleaner" rewrite silently changes every answer.
//
// Each fixture's expectations were produced by running ModelTrace's own
// static/fingerprint-core.js over ModelTrace's published reference answers
// (data/*_reference.jsonl, MIT) and over a synthetic uniform-random answer.
// A mismatch means this port drifted; fix the port, not the fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIMENSION, analyzeOutputs, countNumbers, minimumNumbers, parseNumbers } from "../lib/fingerprint.mjs";
import { loadBank } from "../lib/bank-node.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bank = loadBank();
const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "reference-answers.json"), "utf8"));

const close = (left, right, tolerance, what) =>
  assert.ok(Math.abs(left - right) <= tolerance, `${what}: ${left} != ${right} (tolerance ${tolerance})`);

test("the bank is the one this port was fitted against", () => {
  assert.equal(bank.models.length, 18);
  assert.equal(bank.method.alpha, 0.5);
  assert.equal(bank.method.ordered_block_weight, 0.25);
  assert.deepEqual(bank.method.range, [1, 355]);
  assert.equal(bank.robust.hellinger.centroids.length, 18);
  assert.equal(bank.robust.ordered_blocks.centroids.length, 18);
  assert.ok(bank.robust.ordered_blocks.environment_centroids.length > 1);
  assert.deepEqual(Object.keys(bank.calibration).sort(), ["1", "2", "3"]);
});

test("parsing takes the longest run and splits it on letters", () => {
  assert.deepEqual(parseNumbers("1, 2, 3"), [1, 2, 3]);
  assert.deepEqual(parseNumbers("[147,23,311]"), [147, 23, 311]);
  // A word between two numbers starts a new run, so a label is not glued on.
  assert.deepEqual(parseNumbers("9 numbers then 1 2 3 4 5 6 7 8 9 10"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(parseNumbers("challenge 1 of 300, integers: 5 6 7 8"), [5, 6, 7, 8]);
  // Punctuation alone does not split — ModelTrace's own behaviour, kept as it
  // is: "challenge 1: 5 6 7 8" keeps the leading 1. One stray number in a
  // list of 300 is nothing, and changing it would change every score.
  assert.deepEqual(parseNumbers("challenge 1: 5 6 7 8"), [1, 5, 6, 7, 8]);
  // out-of-range values are dropped, never clamped
  assert.deepEqual(parseNumbers("0 1 355 356 400"), [1, 355]);
  assert.deepEqual(parseNumbers("no numbers here"), []);
});

test("counting puts each value in its own bin", () => {
  const counts = countNumbers([1, 1, 355]);
  assert.equal(counts.length, DIMENSION);
  assert.equal(DIMENSION, 355);
  assert.equal(counts[0], 2);
  assert.equal(counts[354], 1);
  assert.equal(
    counts.reduce((sum, value) => sum + value, 0),
    3,
  );
});

test("an answer needs 80 numbers, or 55% of what was asked for", () => {
  assert.equal(minimumNumbers(0), 80);
  assert.equal(minimumNumbers(100), 80);
  assert.equal(minimumNumbers(292), 161);
  assert.equal(minimumNumbers(332), 183);
});

for (const fixture of fixtures) {
  test(`scores like ModelTrace's own page: ${fixture.name}`, () => {
    const answers = fixture.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count }));
    const result = analyzeOutputs(answers, bank);
    assert.equal(result.prediction, fixture.prediction);
    assert.equal(result.used_outputs, fixture.used_outputs);
    assert.equal(result.candidates, 18);
    // every candidate's probability, not just the winner's: a drift that
    // leaves the order alone still has to be caught here
    for (const [model, probability] of fixture.all_probabilities) {
      const found = result.results.find((item) => item.model === model);
      assert.ok(found, `${model} missing from the answer`);
      close(found.probability, probability, 1e-9, model);
    }
    close(
      result.results.reduce((sum, item) => sum + item.probability, 0),
      1,
      1e-9,
      "probabilities sum to one",
    );
    for (const family of result.family_probabilities) {
      const sum = result.results
        .filter((item) => item.family === family.family)
        .reduce((acc, item) => acc + item.probability, 0);
      close(sum, family.probability, 1e-9, `${family.family} is the sum of its models`);
    }
  });
}

test("more answers are never less sure than fewer", () => {
  const triple = fixtures.find((fixture) => fixture.used_outputs === 3);
  const answers = triple.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count }));
  const one = analyzeOutputs(answers.slice(0, 1), bank);
  const two = analyzeOutputs(answers.slice(0, 2), bank);
  const three = analyzeOutputs(answers, bank);
  assert.equal(one.calibration.queries, "1");
  assert.equal(two.calibration.queries, "2");
  assert.equal(three.calibration.queries, "3");
  for (const result of [one, two, three]) {
    assert.ok(result.probability > 0.9, `${result.used_outputs} answer(s) gave ${result.probability}`);
  }
});

test("a uniform-random answer still gets a confident answer, which is the point of the caveat", () => {
  // Not a bug: this is a closed set. The fixture is here so that a change
  // that "fixes" it by shrinking probabilities is caught as a drift.
  const fixture = fixtures.find((item) => item.name.startsWith("uniform random"));
  const result = analyzeOutputs(
    fixture.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count })),
    bank,
  );
  assert.equal(result.prediction, fixture.prediction);
  assert.ok(result.probability > 0.5, "the closed set answers confidently even with no model's profile");
});

test("a refused answer is dropped, not scored as if it were empty", () => {
  const triple = fixtures.find((fixture) => fixture.used_outputs === 3);
  const answers = triple.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count }));
  const result = analyzeOutputs([{ text: "I can't help with that.", expected_count: 300 }, ...answers], bank);
  assert.equal(result.used_outputs, 3);
  assert.equal(result.diagnostics[0].accepted, false);
  assert.equal(result.diagnostics[0].parsed_numbers, 0);
  assert.equal(result.prediction, triple.prediction);
});

test("nothing usable is an error that says why", () => {
  assert.throws(() => analyzeOutputs([{ text: "sorry", expected_count: 300 }], bank), /no usable answer/);
});

test("excluding models takes them out of the candidates and renormalizes", () => {
  const triple = fixtures.find((fixture) => fixture.used_outputs === 3);
  const answers = triple.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count }));
  const all = analyzeOutputs(answers, bank);
  const loser = all.results[all.results.length - 1].model;
  const without = analyzeOutputs(answers, bank, { exclude: [loser] });
  assert.equal(without.candidates, 17);
  assert.ok(!without.results.some((item) => item.model === loser));
  close(
    without.results.reduce((sum, item) => sum + item.probability, 0),
    1,
    1e-9,
    "renormalized",
  );
});

test("excluding every model is refused rather than answered with nothing", () => {
  const triple = fixtures.find((fixture) => fixture.used_outputs === 3);
  const answers = triple.answers.map((answer) => ({ text: answer.text, expected_count: answer.expected_count }));
  assert.throws(
    () => analyzeOutputs(answers, bank, { exclude: bank.models.map((model) => model.id) }),
    /no candidates left/,
  );
});
