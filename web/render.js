// Turning a run into the page: the verdict, the candidates, the gaps, and the
// caveats that have to travel with every number.

import { summaryLine } from "../lib/report.mjs";
import { caveats } from "../lib/report.mjs";

const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** One model's card: what was asked, what came back, what it looks like. */
export function renderRun(result, bank) {
  const card = el("article", "run");
  const head = el("div", "run-head");
  head.append(el("span", "run-model", result.model));

  const { attribution } = result;
  if (attribution?.scored) {
    const verdict = el("span", "run-verdict");
    verdict.append(document.createTextNode("最像 "));
    verdict.append(el("strong", null, attribution.prediction_name));
    verdict.append(
      document.createTextNode(
        ` · ${percent(attribution.probability)} · 家族 ${attribution.family_prediction_name} ` +
          `${percent(attribution.family_probability)}`,
      ),
    );
    head.append(verdict);
  } else if (result.error) {
    head.append(el("span", "run-verdict bad", "请求失败"));
  } else {
    head.append(el("span", "run-verdict bad", "无法归因"));
  }

  const scored = attribution?.diagnostics?.filter((item) => item.accepted).length ?? 0;
  const asked = attribution?.diagnostics?.length ?? result.challenges.length;
  const answered = attribution?.answered_model;
  const meta = [
    `${scored}/${asked} 题可用`,
    Array.isArray(answered) ? `上游报告 ${answered.join(", ")}` : answered ? `上游报告 ${answered}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  head.append(el("span", "run-meta", meta));
  card.append(head);

  if (attribution?.scored) {
    const candidates = el("div", "candidates");
    for (const [index, item] of attribution.results.entries()) {
      const row = el("div", `cand${index === 0 ? " first" : ""}`);
      row.append(el("span", "cand-name", item.display_name));
      const track = el("div", "cand-track");
      const fill = el("div");
      fill.style.width = `${Math.max(0.4, item.probability * 100)}%`;
      track.append(fill);
      row.append(track);
      row.append(el("span", "cand-prob", percent(item.probability)));
      candidates.append(row);
    }
    card.append(candidates);
  }

  if (attribution?.gaps?.length || result.error) {
    const list = el("ul", "gaps");
    if (result.error) list.append(el("li", null, result.error));
    for (const item of attribution?.diagnostics || []) {
      if (!item.accepted) list.append(el("li", null, `第 ${item.index + 1} 题：${item.gap}`));
    }
    card.append(list);
  }

  if (attribution?.scored) {
    const list = el("ul", "caveats");
    for (const line of caveats(attribution, bank)) list.append(el("li", null, line));
    card.append(list);
  }

  const raw = el("details", "raw");
  raw.append(el("summary", null, "题目与原始回答"));
  const pre = el("pre");
  pre.textContent = result.challenges
    .map((challenge, index) => {
      const answer = result.answers[index];
      const body = answer?.text?.trim() || (answer?.error ? `[失败] ${answer.error}` : "[没有回答]");
      return (
        `--- 第 ${index + 1} 题（期望 ${challenge.expected_count} 个整数）---\n` +
        `${challenge.prompt}\n\n` +
        `--- 回答（${answer?.ms ?? "?"} ms，finish_reason=${answer?.finish_reason ?? "-"}）---\n${body}`
      );
    })
    .join("\n\n");
  raw.append(pre);
  card.append(raw);

  return card;
}

/** The one-line summary the report module would print, for the copy button. */
export function runSummary(result) {
  if (!result.attribution?.scored) return `${result.model}: 无法归因（${result.error || "没有可用回答"}）`;
  return summaryLine(result.attribution);
}
