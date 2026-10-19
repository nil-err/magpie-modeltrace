// The challenges: the prompts the bank was fitted on, and the three lengths.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateChallenges } from "../lib/challenges.mjs";

test("three challenges, with three different lengths from the bank's range", () => {
  const challenges = generateChallenges(3);
  assert.equal(challenges.length, 3);
  const lengths = challenges.map((challenge) => challenge.expected_count);
  assert.equal(new Set(lengths).size, 3, "the lengths have to differ, or two answers look alike by construction");
  for (const length of lengths) {
    assert.ok(length >= 292 && length <= 332, `${length} is outside the 292–332 range the bank was fitted on`);
  }
});

test("a challenge names its own count, its range, the tool ban and the no-sorting rule", () => {
  for (const challenge of generateChallenges(3)) {
    assert.match(challenge.prompt, new RegExp(`${challenge.expected_count} 个 1 到 355`));
    assert.match(challenge.prompt, /禁止调用或借助任何工具/);
    assert.match(challenge.prompt, /不要从 1 开始计数/);
    assert.match(challenge.prompt, /不要回头排序|不要重新排列|不要整理或改写|不要筛选、重排|已经给出的值保持不变/);
    assert.match(challenge.prompt, /直接从第一个取值开始输出/);
    assert.equal(challenge.prompt.indexOf("重复数量"), challenge.prompt.lastIndexOf("重复数量"));
  }
});

test("challenges are unique run to run", () => {
  const ids = new Set();
  const prompts = new Set();
  for (let round = 0; round < 20; round += 1) {
    for (const challenge of generateChallenges(3)) {
      assert.match(challenge.id, /^probe-[1-3]-[0-9a-f-]{36}$/);
      ids.add(challenge.id);
      prompts.add(challenge.prompt);
    }
  }
  assert.equal(ids.size, 60, "every challenge gets its own id");
  assert.ok(prompts.size > 40, `only ${prompts.size} distinct prompts in 60: the templates are not mixing`);
});

test("the count can be raised for a longer run, but stays small", () => {
  assert.equal(generateChallenges(1).length, 1);
  assert.equal(generateChallenges(6).length, 6);
  const lengths = generateChallenges(6).map((challenge) => challenge.expected_count);
  assert.equal(new Set(lengths).size, 6);
});
