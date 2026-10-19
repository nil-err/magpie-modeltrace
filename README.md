# magpie-modeltrace

Model attribution in the browser: pick models on any OpenAI-shaped gateway, ask
them for long lists of "first-instinct" integers, and read which model in
[ModelTrace](https://github.com/xqy2006/ModelTrace)'s fingerprint bank each one
looks most like — with a family probability and every gap that made an answer
unusable.

Made for the question "is this relay / reseller / routing group really serving
the model it says it is?".

**Live:** https://modeltrace.pages.dev — a static page, no backend, nothing
collected. Your gateway URL and key stay in your browser's localStorage.

## Using the page

1. **Connection.** Type the gateway's base URL — `https://gateway.example.com`,
   `https://gateway.example.com/v1`, or the full
   `…/v1/chat/completions`; all three work. Paste a key if the gateway wants one,
   and choose whether it travels as `Authorization: Bearer …`, as `x-api-key`, or
   not at all. Any other header the gateway needs (a tenant id, a routing hint)
   goes in **额外请求头**, one `Name: value` per line.
2. **Models.** **拉取模型列表** reads `GET /v1/models`. Tick the ones to test; the
   filter box narrows a long list, **全选可见** takes everything it matches.
3. **Run.** **开始测试** asks every selected model the challenges, concurrently,
   and attributes each answer as it arrives. **停止** keeps what already finished.

Each result shows the closest model and its probability, the candidate bars, the
gaps (a refused answer, a truncated one, a 429), the exact prompts and the raw
answers. Nothing is uploaded: the browser talks to your gateway and nowhere else.

### The gateway has to allow this page's origin

The page is the client, so every call is cross-origin. On magpie, add the page's
origin to **Settings → CORS origins** (magpie's `settings.CORSOrigins`); a gateway
that answers `Access-Control-Allow-Origin` for other origins is fine too. The
first-party APIs of the big vendors generally refuse browser origins — point the
page at a relay or at your own gateway instead.

**A key in localStorage is a key a script on this page can read.** Serve the page
yourself if that matters, and use a key you are willing to rotate.

## Running it yourself

```sh
npm run dev          # builds dist/ and serves it on http://127.0.0.1:4173
npm run build        # dist/ only
npm test             # the maths' parity, the probes, the page's settings, the tools
```

There is no bundler and no dependency: the page loads the same ES modules the
repository holds, `scripts/build.mjs` copies them into `dist/` and checks the
bank against `data/provenance.json` on the way.

## Deploying to Cloudflare Pages

```sh
npm run deploy       # build, then wrangler pages deploy dist --project-name modeltrace
```

Or connect the repository in the Cloudflare dashboard with build command
`npm run build` and output directory `dist`. Either way the deploy is static
files; there is no Worker, no KV, no secret to set.

`dist/_redirects` serves `index.html` for unknown paths (it is a one-page app) and
`dist/_headers` sets `nosniff` and a `no-referrer` policy.

## Also a magpie plugin

The same maths ships as three magpie tools, for agents that should be able to
run the check themselves:

```sh
magpie plugin add github:nil-err/magpie-modeltrace
magpie plugin                     # modeltrace_fingerprints, modeltrace_challenge, modeltrace_attribute
```

It installs from this repository, not from npm. The repository is tagged
`magpie-plugin`, so it also shows up on magpie's **Plugins › Discover** page, and
`magpie plugin update` picks up a new push to `master`.

| Tool | What it does |
|---|---|
| `modeltrace_fingerprints` | The bank: 18 models over two families, when it was built, and how ModelTrace's own calibration did. Call it first when it matters whether the model in question is even a candidate. |
| `modeltrace_challenge` | ModelTrace's number-generation prompts, for when magpie can't call the model itself (a model behind another tool, a competitor's web page). |
| `modeltrace_attribute` | The attribution. With no `answers`, magpie asks the model itself; with `answers`, it scores the lists you paste. |

```
modeltrace_attribute {"model": "some-relay/gpt-6-astra"}
modeltrace_attribute {"model": "some-relay/x", "answers": ["…", "…", "…"], "expected_counts": [298, 311, 305]}
```

The plugin asks the gateway on loopback, so it needs no key and is billed to
whichever account magpie's routing picks. Its options:

| Key | Default | What it does |
|---|---|---|
| `model` | `""` | The model to test when the caller doesn't name one. |
| `exclude` | `[]` | Models to leave out of the candidates, as the bank names them (`gpt-5.4`) or as magpie does (`provider/gpt-5.4`). |
| `gateway` | `http://127.0.0.1:3425` | The gateway to ask, if not this magpie's own. |
| `budgetMs` | `45000` | How long the three probes may take together. Capped at 50s, under magpie's 55s tool timeout. |
| `parallel` | `true` | Ask all three at once. `false` asks one at a time (slower, usually past the budget). |

### Why not a plugin page?

magpie's plugin pages run in an `allow-scripts` iframe whose CSP is
`connect-src 'none'`: a page cannot fetch its own gateway, and the bridge to the
host offers only theme, options and two whitelisted reads. A model-testing UI
therefore cannot live inside magpie as a page — hence this static site, which the
browser loads from its own origin and points at any gateway that allows it.

## How it works

The model is asked for 292–332 integers from 1 to 355, "by first instinct", with
tools banned and any sorting or de-duplicating forbidden. Models do not pick
random numbers like a dice would: each has its own bias — how often it avoids
round numbers, where in the list it drifts, which last digits it favours.

The score for one answer is

```
0.75 × Hellinger similarity of the digit-count profile, with the shared
       environment direction projected out
+ 0.25 × ordered-block features (four blocks of 16 bins, plus last digits)
```

the per-answer class z-scores are averaged, and a uniform-prior softmax with a
temperature calibrated for the answer count turns them into probabilities. The
family probability is the sum of its models'.

The maths here is a port of ModelTrace's `static/fingerprint-core.js` and the
bank is ModelTrace's own `data/unified_bank.json`; `test/fingerprint.test.mjs`
checks this port against expectations produced by ModelTrace's scorer over
ModelTrace's published reference answers, and `npm run verify:parity` runs the
same comparison against a clone of the upstream repository.

## What the number is not

This is a **closed set**: probabilities among the 18 models the bank holds, under
a uniform prior. A model the bank does not hold is still given to the closest one,
so a high number is not proof of anything — only evidence about a suspicion.

- **System prompts move models.** The bank was fitted on plain answers. Claude
  Code's system prompt in particular shifts how a model writes numbers; ModelTrace
  says outright not to test inside Claude Code for that reason. The page sends the
  challenge as the only message, so it does not inherit a harness's prompt — but a
  relay that injects one is exactly what this is meant to catch.
- **The answers are not independent.** Three challenges asked of one model in one
  conversation share context and can be correlated. The bank's own 100% on three
  answers (216 held-out triples) is *its* accuracy on vendor triples, not this
  probe's.
- **The false-positive rate has not been measured.** ModelTrace ships
  `scripts/evaluate-calibration.mjs` for a holdout set; nothing does that here yet.
  Treat a disagreement as a reason to look, not a verdict.

## Layout

```
web/            the page: index.html, style.css, and the modules it loads
lib/            the maths, the challenges, the probes, the report — no DOM
data/           the bank and its provenance
index.mjs       the magpie plugin's three tools
scripts/        build, local server, bank sync, parity check
test/           node:test over all of it
```

`lib/` is environment-agnostic: the same `fingerprint.mjs`, `challenges.mjs`,
`probe.mjs` and `report.mjs` run in the browser, in the plugin and in the tests.
Only the bank's *location* differs — `lib/bank.mjs` fetches it for the page,
`lib/bank-node.mjs` reads it off disk for the plugin.

## Credit

- [ModelTrace](https://github.com/xqy2006/ModelTrace) by xqy2006 (MIT): the method,
  the prompts, the bank, the scorer.
- [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker),
  which ModelTrace credits for the same idea — random-number bias as a channel
  check — earlier.

Not affiliated with ModelTrace's author. See `THIRD_PARTY_NOTICES.md`.
