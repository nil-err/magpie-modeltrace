// What the results say, in the page's own words.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gapText } from "../web/render.js";

test("a short answer says how short, in the page's words", () => {
  assert.equal(gapText("only 12 numbers came back; 175 are needed"), "只回来 12 个数，至少要 175 个");
});

test("a truncated answer is named as truncated", () => {
  assert.equal(gapText("the answer was cut off at max_tokens"), "回答在 max_tokens 处被截断");
});

test("a timeout is a timeout", () => {
  assert.equal(gapText("did not finish within the probe budget"), "超时未返回");
});

test("a non-JSON gateway answer keeps its status", () => {
  assert.equal(gapText("the gateway answered 502 but not with JSON"), "网关返回 502，但响应不是 JSON");
});

test("an upstream message is carried through, not swallowed", () => {
  assert.equal(gapText("request failed: ECONNREFUSED"), "请求失败：ECONNREFUSED");
});

test("an unknown gap is passed through unchanged rather than blanked", () => {
  assert.equal(gapText("something new happened"), "something new happened");
});
