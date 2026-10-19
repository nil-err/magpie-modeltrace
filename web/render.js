// Turning a run into the page: the verdict, the candidates, the gaps, and the
// caveats that have to travel with every number.
//
// The wording lives here rather than in lib/report.mjs: the report module writes
// for an agent reading a tool answer, this writes for a person reading a page.

import { summaryLine } from "../lib/report.mjs";

const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** At most this many candidate rows; the rest are folded into one line. */
const SHOWN_CANDIDATES = 8;

/** The page's words for a gap lib/report.mjs reported in its own. */
export function gapText(gap) {
  const text = String(gap || "");
  let match;
  if ((match = /^only (\d+) numbers came back; (\d+) are needed$/.exec(text))) {
    return `只回来 ${match[1]} 个数，至少要 ${match[2]} 个`;
  }
  if (text === "the answer was cut off at max_tokens") return "回答在 max_tokens 处被截断";
  if (text === "the request failed") return "请求失败";
  if (text === "did not finish within the probe budget") return "超时未返回";
  if (text === "the caller gave up before this probe started") return "还没开始就被停止";
  if (text === "did not start: the probe budget was spent") return "预算用完，没有发出";
  if ((match = /^the gateway answered (\d+) but not with JSON$/.exec(text))) {
    return `网关返回 ${match[1]}，但响应不是 JSON`;
  }
  if ((match = /^request failed: (.*)$/.exec(text))) return `请求失败：${match[1]}`;
  return text;
}

const CAVEATS = [
  (result, bank) =>
    `闭集：这些概率只在指纹库的 ${bank.models.length} 个模型之间分配（均匀先验）。库外的模型也会被判给最接近的那个，` +
    `所以数字高不等于证据。`,
  () =>
    "指纹库是用 ModelTrace 自己的题目拟合的。能改变模型写数习惯的系统提示（比如 Claude Code 的）会把它推离自己的中心，" +
    "读起来像另一个模型。本页把题目作为唯一一条消息发出，不带 harness 的提示词——但中转偷偷加的那一条，正是这里要抓的东西。",
  (result) =>
    `同一模型的几道题不是独立样本：它们在一次会话里共享上下文，可能相关。指纹库自己 3 题的准确率` +
    `（${(result.calibration.cv_accuracy * 100).toFixed(1)}%，按 ${result.calibration.queries} 题标定）是它在厂商样本上的成绩，不是这次探测的。`,
  () => "这个探测的误报率还没有测过。结论不一致时，把它当成「值得看一眼」的理由，而不是判决。",
];

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
    for (const [index, item] of attribution.results.slice(0, SHOWN_CANDIDATES).entries()) {
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
    const rest = attribution.results.slice(SHOWN_CANDIDATES);
    if (rest.length) {
      // Sorted descending, so the highest of the folded ones bounds them all.
      card.append(el("p", "rest", `其余 ${rest.length} 个候选均不高于 ${percent(rest[0].probability)}`));
    }
  }

  if (attribution?.gaps?.length || result.error) {
    const list = el("ul", "gaps");
    if (result.error) list.append(el("li", null, result.error));
    for (const item of attribution?.diagnostics || []) {
      if (!item.accepted) list.append(el("li", null, `第 ${item.index + 1} 题：${gapText(item.gap)}`));
    }
    card.append(list);
  }

  if (attribution?.scored) {
    const list = el("ul", "caveats");
    for (const line of CAVEATS) list.append(el("li", null, line(attribution, bank)));
    card.append(list);
  }

  const raw = el("details", "raw");
  raw.append(el("summary", null, "题目与原始回答"));
  const pre = el("pre");
  pre.textContent = result.challenges
    .map((challenge, index) => {
      const answer = result.answers[index];
      const body = answer?.text?.trim() || (answer?.error ? `[失败] ${gapText(answer.error)}` : "[没有回答]");
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

/** The tool-answer wording, for anything that copies the result out. */
export function runSummary(result) {
  if (!result.attribution?.scored) return `${result.model}: 无法归因（${result.error || "没有可用回答"}）`;
  return summaryLine(result.attribution);
}
