import * as db from "./db.ts";
import { errMsg, gatherCandidates, pickFair, previewTopic as enginePreview } from "./engine.ts";
import { log } from "./log.ts";
import { Profile } from "./rank.ts";
import type { Paper, Topic } from "./types.ts";

export { errMsg } from "./engine.ts";

export function buildProfile(): Profile | null {
  const liked = db.ratedPapers(1);
  if (!liked.length) return null;
  return new Profile(liked, db.ratedPapers(-1), db.recentPapers());
}

export interface RunSummary {
  runId: number;
  trigger: string;
  status: "ok" | "partial" | "error" | "empty";
  nNew: number;
  nCandidates: number;
  top: Paper[];
  uids: string[];
  notes: string[];
  error?: string;
}

let current: Promise<RunSummary> | null = null;
const listeners: ((s: RunSummary) => void)[] = [];

export const isRunning = () => current !== null;
export const onRunFinished = (fn: (s: RunSummary) => void) => listeners.push(fn);

/** trigger: "schedule" (timer), "tray" (tray menu) or "manual" (button in the window — no toast needed) */
export function runRecommendation(trigger: "schedule" | "manual" | "tray"): Promise<RunSummary> {
  if (!current) {
    current = doRun(trigger).finally(() => (current = null));
    current.then((s) => listeners.forEach((fn) => fn(s))).catch(() => {});
  }
  return current;
}

async function doRun(trigger: string): Promise<RunSummary> {
  const settings = db.getSettings();
  const topics = db.listTopics().filter((t) => t.enabled);
  const now = new Date();
  // look back `lookbackDays`, or further if the app was off since the last good run (max 30 days)
  let sinceMs = now.getTime() - settings.lookbackDays * 86_400_000;
  const lastOk = db.lastOkRun();
  if (lastOk) sinceMs = Math.min(sinceMs, Date.parse(lastOk.startedAt) - 86_400_000);
  sinceMs = Math.max(sinceMs, now.getTime() - 30 * 86_400_000);
  const since = new Date(sinceMs);
  const runId = db.startRun(trigger, since.toISOString());
  const base = { runId, trigger, top: [] as Paper[], uids: [] as string[] };
  log(`run ${runId} (${trigger}) since ${since.toISOString()} for ${topics.length} topics`);

  if (!topics.length) {
    const notes = ["还没有启用的兴趣主题"];
    db.finishRun(runId, { status: "empty", nCandidates: 0, nNew: 0, notes });
    return { ...base, status: "empty", nNew: 0, nCandidates: 0, notes };
  }
  const notes: string[] = [];
  try {
    const { candidates, nFetched } = await gatherCandidates(topics, since, now, buildProfile(), notes, { fresh: true });
    const seen = db.recommendedUids();
    const disliked = db.dislikedUids();
    const fresh = [...candidates.values()].filter((c) =>
      !seen.has(c.paper.uid) && !disliked.has(c.paper.uid) && c.score >= settings.minScore
    );
    const picked = pickFair(fresh, topics, settings.maxPerRun);
    for (const c of picked) {
      db.upsertPaper(c.paper);
      db.insertRec(c.paper.uid, runId, c.topicIds, c.score, c.matched);
    }
    const failedAll = nFetched === 0 && notes.length > 0;
    const status = failedAll ? "error" : notes.length ? "partial" : "ok";
    db.finishRun(runId, {
      status,
      nCandidates: candidates.size,
      nNew: picked.length,
      notes,
      error: failedAll ? notes.join("；") : undefined,
    });
    log(`run ${runId} ${status}: ${nFetched} fetched, ${candidates.size} matched, ${picked.length} new`, notes);
    return {
      ...base,
      status,
      nNew: picked.length,
      nCandidates: candidates.size,
      top: picked.slice(0, 3).map((c) => c.paper),
      uids: picked.map((c) => c.paper.uid),
      notes,
      error: failedAll ? notes.join("；") : undefined,
    };
  } catch (e) {
    const error = errMsg(e);
    log(`run ${runId} failed`, e);
    db.finishRun(runId, { status: "error", nCandidates: 0, nNew: 0, error, notes });
    return { ...base, status: "error", nNew: 0, nCandidates: 0, notes, error };
  }
}

export function previewTopic(t: Omit<Topic, "id" | "createdAt" | "updatedAt">, days = 7) {
  return enginePreview(t, days, buildProfile());
}
