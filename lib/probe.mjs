// Asking magpie's own gateway for the three answers.
//
// The plugin runs inside magpie's plugin host, so the gateway it belongs to is
// reachable on loopback — and a loopback request needs no gateway key (magpie
// treats this computer's own calls as its own). A probe is therefore billed to
// whichever account the routing picks, exactly as an agent's request would be,
// and the plugin never handles a key.
//
// Two hard limits shape everything here:
//   1. magpie answers an MCP tool call at 55s. The probes run at once and each
//      one stops at the budget on its own, so a slow model does not take the
//      answers its faster siblings already gave down with it.
//   2. A scored-but-truncated answer is worse than no answer, so an upstream
//      error, a wrong model or a short list is a gap and never a guess.

export const DEFAULT_BASE = "http://127.0.0.1:3425";

/** magpie cuts a tool call at 55s; leave the report and the write some room. */
export const DEFAULT_BUDGET_MS = 45_000;

function textOf(message) {
  if (!message || typeof message !== "object") return "";
  const parts = [];
  if (typeof message.content === "string") parts.push(message.content);
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === "string") parts.push(part);
      else if (part && typeof part.text === "string") parts.push(part.text);
    }
  }
  // Some upstreams put the whole answer in the reasoning channel and leave
  // content empty. It is still the model's own output, so it is taken.
  if (!parts.join("").trim() && typeof message.reasoning_content === "string") parts.push(message.reasoning_content);
  return parts.join("");
}

/**
 * One probe: ask `model` for the challenge's numbers. Never throws for an
 * upstream error — the caller reports it.
 *
 * @returns {Promise<{ok: boolean, text: string, finish_reason?: string,
 *   status?: number, error?: string, ms: number, model?: string}>}
 */
export async function askModel({ base, model, challenge, signal, fetchImpl = fetch, maxTokens }) {
  const started = Date.now();
  const url = `${String(base || DEFAULT_BASE).replace(/\/+$/, "")}/v1/chat/completions`;
  // A list of ~300 numbers is about 1.4k tokens, but a thinking model spends
  // several thousand more reasoning before it writes any — and max_tokens
  // covers both. Too small a ceiling truncates the list, which is a gap where
  // there was a usable answer.
  const ceiling = maxTokens ?? Math.min(32_768, 4096 + challenge.expected_count * 32);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: challenge.prompt }],
        max_tokens: ceiling,
        stream: false,
      }),
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      text: "",
      error: signal?.aborted ? "did not finish within the probe budget" : `request failed: ${error?.message ?? error}`,
      ms: Date.now() - started,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      text: "",
      status: response.status,
      error: `the gateway answered ${response.status} but not with JSON`,
      ms: Date.now() - started,
    };
  }
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
    return { ok: false, text: "", status: response.status, error: String(message), ms: Date.now() - started };
  }
  const choice = body?.choices?.[0];
  return {
    ok: true,
    text: textOf(choice?.message),
    finish_reason: choice?.finish_reason,
    model: body?.model,
    ms: Date.now() - started,
  };
}

/**
 * A signal that fires at the budget, and when the caller gives up.
 *
 * The timer is this module's own rather than AbortSignal.timeout's: that one is
 * unref'd, so under a test runner that has nothing else to wait on the probes
 * are dropped when the event loop empties instead of being stopped at their
 * deadline. Here the timer holds the loop just as long as it has to.
 */
function budgetSignal(budgetMs, outer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, budgetMs));
  const stop = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (outer?.aborted) stop();
  else outer?.addEventListener?.("abort", stop, { once: true });
  controller.signal.addEventListener("abort", () => outer?.removeEventListener?.("abort", stop), { once: true });
  return controller.signal;
}

/**
 * Asks every challenge and answers what came back, each probe stopping at the
 * same budget on its own.
 *
 * In parallel is the default because a thinking model can spend three minutes
 * on one list: three of those in a row would never fit in magpie's 55s, while
 * three side by side sometimes do — and a model that misses the budget leaves
 * the ones that made it. `parallel: false` is for an upstream that cannot take
 * a burst; expect gaps.
 */
export async function collectAnswers({
  base,
  model,
  challenges,
  budgetMs = DEFAULT_BUDGET_MS,
  parallel = true,
  fetchImpl,
  deadlineSignal,
}) {
  if (deadlineSignal?.aborted) {
    return challenges.map((challenge) => ({
      challenge,
      ok: false,
      text: "",
      error: "the caller gave up before this probe started",
      ms: 0,
    }));
  }
  const signal = budgetSignal(budgetMs, deadlineSignal);
  const run = (challenge) =>
    (signal.aborted
      ? Promise.resolve({ ok: false, text: "", error: "did not start: the probe budget was spent", ms: 0 })
      : askModel({ base, model, challenge, signal, fetchImpl })
    ).then((answer) => ({ challenge, ...answer }));

  if (parallel) return Promise.all(challenges.map(run));
  const out = [];
  for (const challenge of challenges) out.push(await run(challenge));
  return out;
}
