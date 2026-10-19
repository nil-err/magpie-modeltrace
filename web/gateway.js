// Talking to the gateway: what models it serves, and the probes themselves.
//
// The browser is the client here, so every request is a cross-origin one and
// the gateway has to allow this page's origin. A failure is reported with the
// reason a person can act on (CORS, 401, 404) rather than "failed to fetch".

import { chatEndpoint, collectAnswers } from "../lib/probe.mjs";

/** The models a gateway lists, as ids. `GET /v1/models`. */
export async function fetchModels({ base, headers = {}, signal, fetchImpl = fetch }) {
  const url = `${String(base || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/models`;
  let response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (error) {
    throw new Error(describeNetworkError(error, url));
  }
  if (!response.ok) throw new Error(await describeHttpError(response, url));
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${url} 返回的不是 JSON`);
  }
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
  if (!list) throw new Error(`${url} 的响应里没有 data[] 模型列表`);
  return list
    .map((entry) => (typeof entry === "string" ? entry : entry?.id))
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim())
    .sort((left, right) => left.localeCompare(right));
}

/** One model's whole run: the challenges, the answers, the attribution. */
export async function probeModel({ base, model, challenges, headers, timeoutMs, parallel, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const answers = await collectAnswers({
      base,
      model,
      challenges,
      headers,
      parallel,
      budgetMs: timeoutMs,
      fetchImpl,
      deadlineSignal: controller.signal,
    });
    return { model, answers, error: null };
  } catch (error) {
    return { model, answers: [], error: describeNetworkError(error, chatEndpoint(base)) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The reason a request failed, in the words of the thing that failed.
 *
 * A `TypeError: Failed to fetch` is what a browser says for CORS, DNS and
 * refused connections alike, so it is spelled out: the gateway or a proxy
 * answering 4xx/5xx instead says exactly what it thought.
 */
export function describeNetworkError(error, url) {
  const message = String(error?.message || error);
  if (error?.name === "AbortError" || /aborted/i.test(message)) return `超时未返回（${url}）`;
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return (
      `请求没有发出去或响应读不到（${url}）。常见原因：网关没开 CORS（magpie 需把本站 origin 填进 ` +
      `Settings → CORS origins）、地址写错、或浏览器拦下了混合内容（https 页面请求 http 网关）。`
    );
  }
  return `${message}（${url}）`;
}

/** A non-2xx from the gateway, with the body it explained itself with. */
async function describeHttpError(response, url) {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      detail = body?.error?.message || body?.message || text;
    } catch {
      detail = text;
    }
  } catch {
    detail = "";
  }
  const trimmed = String(detail || "").trim().slice(0, 300);
  return `HTTP ${response.status}${trimmed ? `：${trimmed}` : ""}（${url}）`;
}
