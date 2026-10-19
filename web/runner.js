// Running a batch: several models, each with its own probes, without ever
// opening more requests than the user asked for.
//
// A model is one unit of work: its challenges are asked together (that is what
// makes a thinking model fit in a budget at all), and only `concurrency`
// models run at once. Results are yielded as they finish, so a slow model does
// not hold back the ones already done.

import { generateChallenges } from "../lib/challenges.mjs";
import { attribute } from "../lib/report.mjs";
import { probeModel } from "./gateway.js";

/**
 * @param {object} options
 * @param {string} options.base
 * @param {string[]} options.models
 * @param {object} options.headers
 * @param {number} options.challengeCount
 * @param {boolean} options.parallel
 * @param {number} options.concurrency how many models at once
 * @param {number} options.timeoutMs one model's whole budget
 * @param {object} options.bank
 * @param {string[]} options.exclude
 * @param {(result: object) => void} options.onResult
 * @param {(state: {done: number, total: number, running: string[]}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function runBatch(options) {
  const {
    base,
    models,
    headers,
    challengeCount,
    parallel,
    concurrency,
    timeoutMs,
    bank,
    exclude,
    onResult,
    onProgress,
    signal,
  } = options;

  const queue = [...models];
  const running = new Set();
  let done = 0;
  const results = [];

  const report = () =>
    onProgress?.({ done, total: models.length, running: [...running] });

  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const model = queue.shift();
      running.add(model);
      report();
      // Every model gets its own challenges: they are random draws, and
      // reusing one model's prompts for another would correlate the answers.
      const challenges = generateChallenges(challengeCount);
      let result;
      try {
        const probed = await probeModel({ base, model, challenges, headers, timeoutMs, parallel });
        const attribution = probed.answers.length
          ? attribute({ answers: probed.answers, bank, exclude })
          : null;
        result = {
          model,
          challenges,
          answers: probed.answers,
          attribution,
          error: probed.error,
        };
      } catch (error) {
        result = { model, challenges, answers: [], attribution: null, error: String(error?.message || error) };
      }
      running.delete(model);
      done += 1;
      results.push(result);
      report();
      onResult?.(result);
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, models.length)) }, worker);
  await Promise.all(workers);
  report();
  return results;
}
