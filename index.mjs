/**
 * magpie-modeltrace — model attribution as magpie plugin tools.
 *
 * Ask a model for long lists of "first-instinct" integers, compare the
 * numbers it picks against ModelTrace's fingerprint bank, and say which
 * model in that bank it looks most like. Useful when a relay, a reseller or
 * a routing group is suspected of serving something other than what it says.
 *
 * The tools go on magpie's own MCP server (/mcp/magpie/tools) as
 * `modeltrace_fingerprints`, `modeltrace_challenge` and
 * `modeltrace_attribute`, so any agent magpie connects can call them.
 *
 * Everything runs in magpie's plugin host: no key, no network beyond the
 * loopback gateway magpie is already serving, nothing written to disk.
 */

import { bankSummary, loadBank, normalizeExclude } from "./lib/bank.mjs";
import { generateChallenges } from "./lib/challenges.mjs";
import { DEFAULT_BASE, DEFAULT_BUDGET_MS, collectAnswers } from "./lib/probe.mjs";
import { attribute, reportText } from "./lib/report.mjs";

const PLUGIN_ID = "modeltrace";

const options = (given) => {
  const o = given && typeof given === "object" ? given : {};
  return {
    // The gateway of the magpie this plugin runs in. Loopback, so no key.
    base: typeof o.gateway === "string" && o.gateway.trim() ? o.gateway.trim() : DEFAULT_BASE,
    // A model to fall back on when the caller doesn't name one.
    defaultModel: typeof o.model === "string" && o.model.trim() ? o.model.trim() : "",
    // Models to leave out of the candidates: the ones you know are on the
    // path and would only add noise (a router's own aliases, say).
    exclude: Array.isArray(o.exclude) ? o.exclude.filter((m) => typeof m === "string" && m.trim()) : [],
    // How long the three probes may take together. magpie answers a tool
    // call at 55s, so this has to stay under it.
    budgetMs: Number.isFinite(o.budgetMs) && o.budgetMs > 0 ? Math.min(o.budgetMs, 50_000) : DEFAULT_BUDGET_MS,
    // Ask one at a time for an upstream that cannot take a burst. Slower,
    // and usually past the budget for a thinking model.
    parallel: o.parallel !== false,
  };
};

const str = (value, name) => {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required`);
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} is a string`);
  return String(value).trim();
};

/** The model the caller named, or the option, or an error that says what to do. */
const modelOf = (args, opts) => {
  const model = args.model === undefined || args.model === "" ? opts.defaultModel : str(args.model, "model");
  if (!model) {
    throw new Error(
      "name the model to test as magpie serves it (e.g. provider/model), or set the plugin's `model` option",
    );
  }
  return model;
};

const fingerprintsTool = () => ({
  description:
    "Which models the ModelTrace fingerprint bank holds, and how its own calibration did. Call this before " +
    "modeltrace_attribute when it matters whether the model in question is one of the candidates: attributing a " +
    "model the bank does not hold always answers with the closest one, which is not evidence of anything.",
  args: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    const bank = loadBank();
    const summary = bankSummary(bank);
    const three = summary.calibration["3"];
    const lines = [
      `ModelTrace bank built ${bank.built_at}: ${summary.model_count} models, ` +
        `${summary.answers_per_model} reference answers each.`,
      `Method ${summary.method}; integers 1–355; ${summary.minimum_valid_numbers} numbers minimum per answer.`,
      three
        ? `Bank's own calibration on three answers: ${(three.cv_accuracy * 100).toFixed(1)}% ` +
          `(${three.cv_samples} held-out triples).`
        : "",
      "",
      "Models:",
      ...summary.families.flatMap((family) => [
        `  ${family.display_name}:`,
        ...family.models.map((id) => `    ${id}`),
      ]),
      "",
      "That accuracy is ModelTrace's, measured on reference triples taken from the vendors. It is not this probe's: " +
        "answers taken in one conversation share context, and a system prompt the bank never saw can move a " +
        "model's numbers away from its own centroid.",
    ].filter((line) => line !== "");
    return { output: lines.join("\n"), ...summary };
  },
});

const challengeTool = () => ({
  description:
    "ModelTrace's three number-generation challenges. Use it when magpie cannot call the model itself (a model " +
    "behind another tool, a competitor's chat page) or when you want to keep the exact prompts: copy each " +
    "challenge into the model, keep whole answers, then pass them to modeltrace_attribute's `answers`.",
  args: {
    type: "object",
    properties: {
      count: { type: "number", description: "how many challenges; 3 (the default) is what the bank was fitted on" },
    },
    additionalProperties: false,
  },
  async execute(args) {
    const count = Number.isFinite(args.count) && args.count > 0 ? Math.min(6, Math.floor(args.count)) : 3;
    const challenges = generateChallenges(count);
    const lines = [
      "Send each challenge to the same model, one at a time, and keep the whole answer. Then call " +
        "modeltrace_attribute with the answers in this order.",
      "",
      ...challenges.flatMap((challenge, index) => [
        `--- challenge ${index + 1}: expect ${challenge.expected_count} integers ---`,
        challenge.prompt,
        "",
      ]),
    ];
    return { output: lines.join("\n"), challenges };
  },
});

const attributeTool = (opts) => ({
  description:
    "Attribute a model to the ModelTrace fingerprint bank. With no `answers`, magpie asks the model itself for " +
    "three long lists of first-instinct integers and scores them; with `answers`, it scores lists you already " +
    "have, one per challenge in order. Answers that were refused, cut off or too short are reported as gaps and " +
    "never scored. The result is a closed-set probability over the bank's models: a model the bank does not hold " +
    "still answers with the closest one, so read it as evidence about a suspected swap, not as proof.",
  args: {
    type: "object",
    properties: {
      model: {
        type: "string",
        description:
          "the model as magpie serves it, e.g. provider/model; optional when the plugin's `model` option is set",
      },
      answers: {
        type: "array",
        items: { type: "string" },
        description:
          "answers you already have, one per challenge in order; leave it out to have magpie ask the model " +
          "(three challenges, about 45 seconds)",
      },
      expected_counts: {
        type: "array",
        items: { type: "number" },
        description: "only with `answers`: how many integers each answer was asked for",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "models to leave out of the candidates for this run",
      },
      gateway: {
        type: "string",
        description: "the gateway to ask, if not this magpie's loopback (http://127.0.0.1:3425)",
      },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const bank = loadBank();
    const exclude = normalizeExclude(
      [...opts.exclude, ...(Array.isArray(args.exclude) ? args.exclude.filter((m) => typeof m === "string") : [])],
      bank,
    );
    const given = Array.isArray(args.answers) ? args.answers.filter((a) => typeof a === "string" && a.trim()) : [];

    let answers;
    if (given.length) {
      const counts = Array.isArray(args.expected_counts) ? args.expected_counts : [];
      answers = given.map((text, index) => {
        const expected = Number(counts[index]) || 0;
        return {
          challenge: {
            id: `given-${index + 1}`,
            // 0 means "unknown": the 80-number floor still applies.
            expected_count: expected,
            prompt: "",
          },
          ok: true,
          text,
          model_asked: args.model ? String(args.model) : opts.defaultModel,
          model: null,
          ms: null,
        };
      });
    } else {
      const model = modelOf(args, opts);
      const challenges = generateChallenges(3);
      const collected = await collectAnswers({
        base: args.gateway ? String(args.gateway) : opts.base,
        model,
        challenges,
        budgetMs: opts.budgetMs,
        parallel: opts.parallel,
        deadlineSignal: ctx?.abort,
      });
      answers = collected.map((answer) => ({ ...answer, model_asked: model }));
    }

    const result = attribute({ answers, bank, exclude });
    return { output: reportText(result, bank), ...result };
  },
});

export const ModelTracePlugin = async (_input, given) => {
  const opts = options(given);
  return {
    tool: {
      fingerprints: fingerprintsTool(),
      challenge: challengeTool(),
      attribute: attributeTool(opts),
    },
  };
};

// What the tests use, and where a future non-tool surface would hang off.
export const _internal = { attributeTool, challengeTool, fingerprintsTool, options, PLUGIN_ID };
