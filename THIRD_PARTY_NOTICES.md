# Third-party notices

## ModelTrace

This package ports and ships parts of [ModelTrace](https://github.com/xqy2006/ModelTrace),
Copyright (c) xqy2006, MIT License.

| Moved here | From |
|---|---|
| `lib/fingerprint.mjs` | `static/fingerprint-core.js` — the scorer, ported to ESM. The arithmetic is unchanged on purpose: the bank's centroids, nuisance basis and calibration betas were fitted against it. |
| `lib/challenges.mjs` | `static/challenge-browser.js` — the prompt templates and the 292–332 length draw. |
| `data/unified_bank.json` | `data/unified_bank.json`, copied as it ships (18 models, 36 reference answers each). Its sha256 is recorded in `data/provenance.json`. |
| `test/fixtures/reference-answers.json` | Answers from `data/gpt_reference.jsonl` and `data/claude_reference.jsonl`, plus a synthetic uniform-random answer. The expectations were produced by running ModelTrace's own scorer over them. |

ModelTrace's MIT license follows.

```
MIT License

Copyright (c) xqy2006

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The bank's reference answers were collected by ModelTrace's author from the
vendors' own endpoints (OpenAI's Codex for the GPT models, OAIPro for the Claude
ones). Nothing here re-collects them.
