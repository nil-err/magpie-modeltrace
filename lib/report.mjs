// Turning probe answers into an attribution, and into words a person reads.

import { analyzeOutputs, minimumNumbers, parseNumbers } from "./fingerprint.mjs";
import { bankIdOf, inBank } from "./bank.mjs";

const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;

/**
 * Scores the answers. Each answer's own gap is reported before anything is
 * scored, so a probe that was refused, cut off or answered by another model
 * is visible as a gap rather than folded into the number.
 */
export function attribute({ answers, bank, exclude }) {
  const diagnostics = answers.map((answer, index) => {
    const numbers = parseNumbers(answer.text || "");
    const minimum = minimumNumbers(answer.challenge?.expected_count);
    const gaps = [];
    if (!answer.ok) gaps.push(answer.error || "the request failed");
    else if (answer.finish_reason === "length") gaps.push("the answer was cut off at max_tokens");
    else if (numbers.length < minimum) {
      gaps.push(`only ${numbers.length} numbers came back; ${minimum} are needed`);
    }
    return {
      index,
      model_asked: answer.model_asked,
      model_answered: answer.model || null,
      parsed_numbers: numbers.length,
      minimum_numbers: minimum,
      finish_reason: answer.finish_reason ?? null,
      accepted: gaps.length === 0,
      gap: gaps.length ? gaps.join("; ") : null,
      ms: answer.ms ?? null,
    };
  });

  const usable = answers.filter((_, index) => diagnostics[index].accepted);
  if (!usable.length) {
    return {
      scored: false,
      reason: "no answer could be scored",
      diagnostics,
      gaps: diagnostics.map((item) => item.gap).filter(Boolean),
    };
  }

  const result = analyzeOutputs(
    usable.map((answer) => ({ text: answer.text, expected_count: answer.challenge.expected_count })),
    bank,
    { exclude },
  );

  const answeredBy = [
    ...new Set(diagnostics.map((item) => item.model_answered).filter(Boolean)),
  ];
  const asked = answers[0]?.model_asked ?? "";

  return {
    ...result,
    scored: true,
    asked_model: asked,
    answered_model: answeredBy.length === 1 ? answeredBy[0] : answeredBy,
    diagnostics,
    gaps: diagnostics.map((item) => item.gap).filter(Boolean),
    expected_model_in_bank: inBank(asked, bank) ? bankIdOf(asked, bank) : null,
    self_consistent: answeredBy.length === 0 ? null : answeredBy.every((id) => id === answeredBy[0]),
  };
}

/** One line summary, for a tool answer's first line. */
export function summaryLine(result) {
  if (!result.scored) return `ModelTrace could not score ${result.asked_model || "this model"}: ${result.reason}`;
  const family = `${result.family_prediction_name} ${percent(result.family_probability)}`;
  const gaps = result.diagnostics.filter((item) => !item.accepted).length;
  return (
    `ModelTrace says ${result.asked_model} looks most like ${result.prediction_name} ` +
    `(${percent(result.probability)} of the closed set, family ${family}), ` +
    `${result.used_outputs}/${result.diagnostics.length} answers scored` +
    (gaps ? `, ${gaps} gap${gaps > 1 ? "s" : ""}` : "")
  );
}

/** The caveats that must travel with every answer. */
export function caveats(result, bank) {
  const out = [
    "Closed set: these are probabilities among the " +
      `${bank.models.length} models the bank holds, under a uniform prior. ` +
      "A model the bank does not hold is still given to the closest one, so a high number is not proof of anything.",
    "The bank was fitted on answers to ModelTrace's own prompts; a system prompt that changes how a model writes " +
      "numbers (Claude Code's, for one) moves it away from its own centroid and can be read as another model.",
    "Answers taken in one conversation share context, so they are not independent samples: the three-answer " +
      "accuracy the bank reports (see `fingerprints`) is not this probe's accuracy. The plugin's own false-positive " +
      "rate has not been measured.",
  ];
  if (result.gaps?.length) out.push(`Gaps: ${result.gaps.length} answer(s) could not be scored — see diagnostics.`);
  if (result.self_consistent === false) {
    out.push("The upstream reported a different model on different answers; treat this run with suspicion.");
  }
  if (result.expected_model_in_bank === null && result.asked_model) {
    out.push(`"${result.asked_model}" is not one of the bank's labels, so there is nothing to compare it against directly.`);
  }
  return out;
}

/** The whole answer as text: a summary, the table, the gaps, and the caveats. */
export function reportText(result, bank) {
  const lines = [summaryLine(result)];
  if (result.scored) {
    const rows = result.results
      .slice(0, 8)
      .map(
        (item, index) =>
          `${String(index + 1).padStart(2)}. ${item.display_name.padEnd(28)} ${percent(item.probability).padStart(7)}  ` +
          `family ${item.family_name}`,
      );
    lines.push("", "Candidates:", ...rows);
    if (result.results.length > 8) lines.push(`    …and ${result.results.length - 8} more in the structured answer`);
    const gaps = result.diagnostics.filter((item) => !item.accepted);
    if (gaps.length) {
      lines.push("", "Gaps:");
      for (const gap of gaps) lines.push(`  challenge ${gap.index + 1}: ${gap.gap}`);
    }
  } else if (result.diagnostics?.length) {
    lines.push("", "Gaps:");
    for (const gap of result.diagnostics) lines.push(`  challenge ${gap.index + 1}: ${gap.gap}`);
  }
  lines.push("", "Read this as:", ...caveats(result, bank).map((line) => `  - ${line}`));
  return lines.join("\n");
}
