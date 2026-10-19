// The page: wiring the form, the model list, the run and the results together.
//
// State lives in one object, is written back to localStorage as it changes, and
// is the only thing the handlers read. Nothing here knows how a probe works —
// that is lib/ and web/runner.js.

import { bankSummary, loadBank } from "../lib/bank.mjs";
import { fetchModels } from "./gateway.js";
import { renderRun } from "./render.js";
import { runBatch } from "./runner.js";
import { DEFAULTS, loadSettings, requestHeaders, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

const state = {
  settings: loadSettings(),
  bank: null,
  models: [],
  results: [],
  running: false,
  controller: null,
};

/* ---------- the form ---------- */

const FIELDS = {
  base: "base",
  key: "key",
  keyHeader: "keyHeader",
  headers: "headers",
  exclude: "exclude",
  challenges: "challenges",
  parallel: "parallel",
  concurrency: "concurrency",
  timeoutSeconds: "timeout",
  filter: "filter",
};

function fillForm() {
  for (const [field, id] of Object.entries(FIELDS)) {
    const node = $(id);
    if (!node) continue;
    if (node.type === "checkbox") node.checked = Boolean(state.settings[field]);
    else if (field === "parallel") node.value = state.settings.parallel ? "true" : "false";
    else node.value = state.settings[field];
  }
  renderModels();
}

function readForm() {
  const read = (id) => $(id)?.value ?? "";
  state.settings = {
    ...state.settings,
    base: read("base").trim(),
    key: read("key"),
    keyHeader: read("keyHeader"),
    headers: read("headers"),
    exclude: read("exclude"),
    challenges: Number(read("challenges")) || DEFAULTS.challenges,
    parallel: read("parallel") === "true",
    concurrency: Number(read("concurrency")) || DEFAULTS.concurrency,
    timeoutSeconds: Number(read("timeout")) || DEFAULTS.timeoutSeconds,
    filter: read("filter"),
  };
  saveSettings(state.settings);
}

function save() {
  readForm();
  setState("connState", "已保存到本机 localStorage", "ok");
}

/* ---------- the model list ---------- */

function renderModels() {
  const list = $("modelList");
  const filter = String(state.settings.filter || "").trim().toLowerCase();
  const shown = state.models.filter((model) => !filter || model.toLowerCase().includes(filter));
  const chosen = new Set(state.settings.selected);

  list.replaceChildren();
  if (!shown.length) {
    const empty = document.createElement("span");
    empty.className = "state";
    empty.textContent = state.models.length
      ? "没有匹配的模型"
      : "还没有模型：填好网关后点「拉取模型列表」";
    list.append(empty);
  }
  for (const model of shown) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = chosen.has(model);
    box.addEventListener("change", () => {
      const next = new Set(state.settings.selected);
      if (box.checked) next.add(model);
      else next.delete(model);
      state.settings.selected = [...next];
      saveSettings(state.settings);
      updateCounts();
    });
    const name = document.createElement("span");
    name.className = "mid";
    name.textContent = model;
    label.append(box, name);
    list.append(label);
  }
  updateCounts();
}

function updateCounts() {
  const chosen = state.settings.selected.length;
  setState("modelCount", `${state.models.length} 个可用，已选 ${chosen} 个`);
  $("start").disabled = state.running || chosen === 0;
  $("stop").disabled = !state.running;
}

async function loadModels() {
  readForm();
  if (!state.settings.base) {
    setState("connState", "先填网关地址", "bad");
    return;
  }
  setState("connState", "拉取中…");
  $("loadModels").disabled = true;
  try {
    const models = await fetchModels({ base: state.settings.base, headers: requestHeaders(state.settings) });
    state.models = models;
    // A model that was selected before and is still served stays selected.
    const served = new Set(models);
    state.settings.selected = state.settings.selected.filter((model) => served.has(model));
    saveSettings(state.settings);
    renderModels();
    setState("connState", `拉取到 ${models.length} 个模型`, "ok");
  } catch (error) {
    setState("connState", String(error?.message || error), "bad");
  } finally {
    $("loadModels").disabled = false;
  }
}

/* ---------- the run ---------- */

async function start() {
  readForm();
  if (state.running) return;
  if (!state.settings.base) {
    setState("runState", "先填网关地址", "bad");
    return;
  }
  if (!state.settings.selected.length) {
    setState("runState", "先选至少一个模型", "bad");
    return;
  }
  if (!state.bank) {
    setState("runState", "指纹库还没加载完", "bad");
    return;
  }

  state.running = true;
  state.results = [];
  state.controller = new AbortController();
  $("resultBody").replaceChildren();
  $("start").disabled = true;
  $("stop").disabled = false;
  $("progress").hidden = false;
  setState("runState", `开始测试 ${state.settings.selected.length} 个模型…`);

  const exclude = String(state.settings.exclude || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    await runBatch({
      base: state.settings.base,
      models: state.settings.selected,
      headers: requestHeaders(state.settings),
      challengeCount: state.settings.challenges,
      parallel: state.settings.parallel,
      concurrency: state.settings.concurrency,
      timeoutMs: state.settings.timeoutSeconds * 1000,
      bank: state.bank,
      exclude,
      signal: state.controller.signal,
      onResult: (result) => {
        state.results.push(result);
        $("resultBody").append(renderRun(result, state.bank));
      },
      onProgress: ({ done, total, running }) => {
        $("progressBar").style.width = `${total ? (done / total) * 100 : 0}%`;
        setState(
          "runState",
          `${done}/${total} 完成${running.length ? `，进行中：${running.join("、")}` : ""}`,
        );
      },
    });
    setState(
      "runState",
      state.controller.signal.aborted ? `已停止，完成 ${state.results.length} 个` : `全部完成，共 ${state.results.length} 个`,
      state.controller.signal.aborted ? "" : "ok",
    );
  } catch (error) {
    setState("runState", String(error?.message || error), "bad");
  } finally {
    state.running = false;
    state.controller = null;
    $("start").disabled = false;
    $("stop").disabled = true;
  }
}

function stop() {
  state.controller?.abort();
  setState("runState", "正在停止…");
}

/* ---------- the bank ---------- */

function renderBank(bank) {
  const summary = bankSummary(bank);
  const lines = [
    `指纹库构建于 ${summary.built_at}：${summary.model_count} 个模型，每个 ${summary.answers_per_model} 条参考回答。`,
    `方法 ${summary.method}；整数范围 1–355；每题至少 ${summary.minimum_valid_numbers} 个数。`,
    `指纹库自身的标定（3 题）：${(summary.calibration["3"]?.cv_accuracy * 100 || 0).toFixed(1)}%` +
      `（${summary.calibration["3"]?.cv_samples ?? 0} 组留出三元组）。`,
    "",
    ...summary.families.flatMap((family) => [
      `${family.display_name}：`,
      ...family.models.map((id) => `  ${id}`),
    ]),
  ];
  $("bankBody").textContent = lines.join("\n");
  $("bankBody").style.whiteSpace = "pre-wrap";
}

/* ---------- boot ---------- */

function setState(id, text, kind = "") {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.className = `state${kind ? ` ${kind}` : ""}`;
}

async function boot() {
  fillForm();

  $("save").addEventListener("click", save);
  $("loadModels").addEventListener("click", loadModels);
  $("useProxy").addEventListener("click", () => {
    // The page's own /gw proxy: same-origin, so no preflight and no Access
    // service token in the browser. A gateway key still has to be typed.
    $("base").value = "/gw";
    readForm();
    setState("connState", "已切到本站 /gw 代理；填上网关 key 后点「拉取模型列表」", "ok");
  });
  $("start").addEventListener("click", start);
  $("stop").addEventListener("click", stop);

  $("filter").addEventListener("input", () => {
    state.settings.filter = $("filter").value;
    saveSettings(state.settings);
    renderModels();
  });
  $("selectAll").addEventListener("click", () => {
    const filter = String(state.settings.filter || "").trim().toLowerCase();
    const shown = state.models.filter((model) => !filter || model.toLowerCase().includes(filter));
    state.settings.selected = [...new Set([...state.settings.selected, ...shown])];
    saveSettings(state.settings);
    renderModels();
  });
  $("selectNone").addEventListener("click", () => {
    state.settings.selected = [];
    saveSettings(state.settings);
    renderModels();
  });

  // Any edit is kept as it is typed: a reload must not lose a pasted key.
  for (const id of Object.values(FIELDS)) {
    const node = $(id);
    if (!node) continue;
    node.addEventListener("change", readForm);
    if (node.tagName === "TEXTAREA" || node.type === "text" || node.type === "url" || node.type === "password") {
      node.addEventListener("input", readForm);
    }
  }

  try {
    state.bank = await loadBank("./bank.json");
    renderBank(state.bank);
  } catch (error) {
    $("bankBody").textContent = `指纹库加载失败：${error?.message || error}`;
    $("bankBody").className = "hint bad";
    return;
  }

  // A gateway that is already configured can fill the list on its own; a
  // failure here is only a hint, never an error on load.
  if (state.settings.base) {
    setState("connState", "正在读取模型列表…");
    try {
      state.models = await fetchModels({
        base: state.settings.base,
        headers: requestHeaders(state.settings),
      });
      const served = new Set(state.models);
      state.settings.selected = state.settings.selected.filter((model) => served.has(model));
      renderModels();
      setState("connState", `拉取到 ${state.models.length} 个模型`, "ok");
    } catch (error) {
      setState("connState", String(error?.message || error), "bad");
    }
  }
}

boot();
