import * as db from "./db.ts";
import { log } from "./log.ts";
import { isRunning, runRecommendation } from "./recommend.ts";
import { computeNextRun } from "./schedule.ts";

const appStart = Date.now();
const GRACE_MS = 20_000;
let nextRunAt: number | null = null;

export const getNextRunAt = () => nextRunAt;

let soonTimer: ReturnType<typeof setTimeout> | undefined;

/** A topic was just added: run shortly — debounced, so adding several topics in a row gives one run. */
export function requestRunSoon(delayMs = 3000) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => {
    if (isRunning()) return requestRunSoon(5000);
    soonTimer = undefined;
    runRecommendation("manual").finally(tick);
  }, delayMs);
}

export function tick() {
  if (soonTimer !== undefined) return;
  const last = db.lastRealRun();
  const raw = computeNextRun(db.getSettings(), last ? Date.parse(last.startedAt) : null, last?.status === "error");
  const hasTopics = db.listTopics().some((t) => t.enabled);
  nextRunAt = raw === null || !hasTopics ? null : Math.max(raw, appStart + GRACE_MS);
  if (nextRunAt !== null && Date.now() >= nextRunAt && !isRunning()) {
    log("scheduled run due");
    runRecommendation("schedule").finally(tick);
  }
}

export function startScheduler() {
  tick();
  setInterval(tick, 15_000);
}
