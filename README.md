# magpie-modeltrace

Model attribution as [magpie](https://usemagpie.ai) plugin tools: ask a model for
long lists of "first-instinct" integers, compare what it picks against
[ModelTrace](https://github.com/xqy2006/ModelTrace)'s fingerprint bank, and get
the model it looks most like — plus a family probability and every gap that made
an answer unusable.

Made for the question "is this relay / reseller / routing group really serving the
model it says it is?".

```sh
magpie plugin add tools-modeltrace
magpie plugin                     # lists the tools: modeltrace_fingerprints, modeltrace_challenge, modeltrace_attribute
```

magpie serves them on its MCP server, `/mcp/magpie/tools`, to every agent it has
connected (magpie v0.1.1260 or later names them after the plugin's short name,
`modeltrace`).

## The three tools

| Tool | What it does |
|---|---|
| `modeltrace_fingerprints` | The bank: 18 models over two families, when it was built, and how ModelTrace's own calibration did. Call it first when it matters whether the model in question is even a candidate. |
| `modeltrace_challenge` | ModelTrace's three number-generation prompts, for when magpie can't call the model itself (a model behind another tool, a competitor's web page). |
| `modeltrace_attribute` | The attribution. With no `answers`, magpie asks the model itself; with `answers`, it scores the lists you paste. |

```
modeltrace_attribute {"model": "some-relay/gpt-6-astra"}
modeltrace_attribute {"model": "some-relay/x", "answers": ["…", "…", "…"], "expected_counts": [298, 311, 305]}
```

A run looks like this:

```
ModelTrace says some-relay/gpt-6-astra looks most like gpt-6-astra (99.4% of the
closed set, family GPT 99.4%), 3/3 answers scored

Candidates:
 1. gpt-6-astra                  99.4%  family GPT
 2. gpt-6-sol                     0.4%  family GPT
 …
Read this as:
  - Closed set: …
```

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

## Probing through magpie

The plugin runs inside magpie's plugin host, so it asks the gateway that is
already there, on loopback:

- **No key.** magpie lets this computer's own calls in; the plugin never sees or
  stores a gateway key.
- **Billed as any request.** The probe goes through magpie's routing like an
  agent's request would: an account, a group, a failover, the same allowances.
- **Three at once, in one budget.** magpie answers an MCP tool call at 55s, so the
  three challenges are asked in parallel and share a 45s budget. A thinking model
  can take three minutes on one list; a probe that doesn't make it is a gap, not a
  score. Set the plugin option `parallel: false` for an upstream that can't take a
  burst — expect gaps.

## Options

`magpie plugin options tools-modeltrace '<json>'`, or Plugins › Built-in:

| Key | Default | What it does |
|---|---|---|
| `model` | `""` | The model to test when the caller doesn't name one. |
| `exclude` | `[]` | Models to leave out of the candidates, as the bank names them (`gpt-5.4`) or as magpie does (`provider/gpt-5.4`). |
| `gateway` | `http://127.0.0.1:3425` | The gateway to ask, if not this magpie's own. |
| `budgetMs` | `45000` | How long the three probes may take together. Capped at 50s, under magpie's 55s tool timeout. |
| `parallel` | `true` | Ask all three at once. `false` asks one at a time (slower, usually past the budget). |

## What the number is not

This is a **closed set**: probabilities among the 18 models the bank holds, under
a uniform prior. A model the bank does not hold is still given to the closest one,
so a high number is not proof of anything — only evidence about a suspicion.

- **System prompts move models.** The bank was fitted on plain answers. Claude
  Code's system prompt in particular shifts how a model writes numbers; ModelTrace
  says outright not to test inside Claude Code for that reason. Whatever the agent's
  harness sends, the probe inherits.
- **The three answers are not independent.** They are asked of one model in one
  setup, so they share context and can be correlated. The bank's own 100% on
  three answers (216 held-out triples) is *its* accuracy on vendor triples, not
  this probe's.
- **The plugin's false-positive rate has not been measured.** ModelTrace ships
  `scripts/evaluate-calibration.mjs` for a holdout set; nothing does that here yet.
  Treat a disagreement as a reason to look, not a verdict.

## Development

```sh
npm test                     # 51 cases: the maths' parity, the probes, the tools, the words
npm run verify:parity        # the same comparison against a clone of xqy2006/ModelTrace
npm run sync:bank            # check whether upstream's bank moved (writes nothing without --write)
```

The bank ships inside the package (`data/unified_bank.json`), so the tools work
offline and never fetch anything at runtime. `data/provenance.json` records where
it came from and what it hashed to.

## Credit

- [ModelTrace](https://github.com/xqy2006/ModelTrace) by xqy2006 (MIT): the method,
  the prompts, the bank, the scorer. This package is a port of them into magpie.
- [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker),
  which ModelTrace credits for the same idea — random-number bias as a channel
  check — earlier.

Not affiliated with ModelTrace's author. See `THIRD_PARTY_NOTICES.md`.
