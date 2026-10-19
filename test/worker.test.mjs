// The /gw proxy: what it forwards, and what it must never forward.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proxyTarget } from "../web/_worker.js";

const ORIGIN = "https://magpie.teyvat.org";

test("a v1 path is forwarded to the gateway", () => {
  assert.equal(proxyTarget("/gw/v1/models", "", ORIGIN), `${ORIGIN}/v1/models`);
});

test("the query string travels", () => {
  assert.equal(proxyTarget("/gw/v1/models", "?a=1", ORIGIN), `${ORIGIN}/v1/models?a=1`);
});

test("chat completions is forwarded", () => {
  assert.equal(proxyTarget("/gw/v1/chat/completions", "", ORIGIN), `${ORIGIN}/v1/chat/completions`);
});

test("the page's own paths are not forwarded", () => {
  for (const path of ["/", "/app.js", "/bank.json", "/lib/probe.mjs", "/gw", "/gw/"]) {
    assert.equal(proxyTarget(path, "", ORIGIN), "", `${path} must be served as an asset`);
  }
});

test("anything under /gw that is not /v1/ is not forwarded", () => {
  // The proxy is a window onto /v1, not a second way into the whole gateway.
  for (const path of ["/gw/admin", "/gw/v1", "/gw/settings", "/gw/../api/settings", "/gw/v1x/models"]) {
    assert.equal(proxyTarget(path, "", ORIGIN), "", `${path} must not reach magpie`);
  }
});

test("a trailing slash on the configured origin does not double up", () => {
  assert.equal(proxyTarget("/gw/v1/models", "", `${ORIGIN}/`), `${ORIGIN}/v1/models`);
});
