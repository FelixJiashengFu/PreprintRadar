/**
 * 每日简报 — once a day, turn the recommendations collected since the previous brief into one HTML
 * page inside the export folder. It is printed from a browser (Ctrl+P → 另存为 PDF), so it needs no
 * PDF pipeline and no network: the brief is ready even when every source is unreachable.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as db from "./db.ts";
import { log } from "./log.ts";
import { errMsg } from "./recommend.ts";
import { computeNextBrief, localDayKey } from "./schedule.ts";
import { briefDateLabel, briefHtml, type BriefItem } from "./templates.ts";
import { stampLocal } from "./text.ts";

/** What the last brief covered; also the start of the next window. */
export interface BriefFile {
  at: string;
  path: string;
  n: number;
  since: string;
}

const KEY = "brief";
/** A brief lists at most this many papers (the rest are just counted). */
const MAX_ITEMS = 30;
/** A long absence must not produce a 300-page brief. */
const MAX_LOOKBACK = 14 * 86_400_000;
const RETRY_MS = 30 * 60_000;

export function lastBrief(): BriefFile | null {
  const f = db.kvGet<BriefFile | null>(KEY, null);
  return f && typeof f.at === "string" && !Number.isNaN(Date.parse(f.at)) ? f : null;
}

export const lastBriefDay = () => {
  const f = lastBrief();
  return f ? localDayKey(new Date(f.at)) : null;
};

/** When the next brief is due: 0 = now, null = 每日简报 switched off. */
export function nextBriefAt(now = Date.now()): number | null {
  return computeNextBrief(db.getSettings(), lastBriefDay(), now);
}

export interface BriefResult {
  ok: boolean;
  path?: string;
  n: number;
  /** nothing to report (no new recommendations in the window) */
  skipped: boolean;
  message: string;
}

let running: Promise<BriefResult> | null = null;
export const isBriefRunning = () => running !== null;

type Listener = (r: BriefResult) => void;
const listeners: Listener[] = [];
/** Called after an automatic brief, so the app can tell the user it is there. */
export const onBrief = (fn: Listener) => listeners.push(fn);

let retryAt = 0;
/** After a failure the scheduler waits instead of hammering the disk every tick. */
export const briefRetryAt = () => retryAt;

export function generateBrief(trigger: "auto" | "manual"): Promise<BriefResult> {
  running ??= Promise.resolve()
    .then(() => doGenerate(trigger))
    .finally(() => {
      running = null;
    });
  return running;
}

function uniquePath(dir: string, stem: string, suffix: string): string {
  let path = join(dir, stem + suffix);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${stem} (${n})${suffix}`);
  return path;
}

function doGenerate(trigger: "auto" | "manual"): BriefResult {
  const s = db.getSettings();
  const now = new Date();
  try {
    const prev = lastBrief();
    // window = everything since the previous brief; the first brief looks back 24 hours
    const floor = now.getTime() - MAX_LOOKBACK;
    let sinceMs = prev ? Date.parse(prev.at) : now.getTime() - 86_400_000;
    if (!Number.isFinite(sinceMs) || sinceMs < floor) sinceMs = floor;
    const since = new Date(sinceMs);

    const recs = db.recsBetween(since.toISOString(), now.toISOString());
    const names = new Map(db.listTopics().map((t) => [t.id, t.name]));
    const items: BriefItem[] = recs.slice(0, MAX_ITEMS).map((r) => ({
      paper: r.paper,
      score: r.score,
      matched: r.matched,
      topics: r.topicIds.map((id) => names.get(id) ?? "").filter(Boolean),
    }));

    if (!items.length) {
      // nothing to write, but move the window on — otherwise tomorrow's brief repeats this check
      db.kvSet(KEY, { at: now.toISOString(), path: "", n: 0, since: since.toISOString() });
      log("brief: no new recommendations, nothing written");
      return { ok: true, n: 0, skipped: true, message: "这段时间没有新的推荐，没有生成简报" };
    }

    const html = briefHtml({
      dateLabel: briefDateLabel(now),
      sinceLabel: stampLocal(since),
      total: recs.length,
      items,
    });
    Deno.mkdirSync(s.exportDir, { recursive: true });
    const path = uniquePath(s.exportDir, `简报 ${stampLocal(now)}`, ".html");
    Deno.writeTextFileSync(path, html);
    db.kvSet(KEY, { at: now.toISOString(), path, n: recs.length, since: since.toISOString() });
    db.addExport({
      mode: "brief",
      title: `每日简报 ${localDayKey(now)}`,
      n: recs.length,
      nMissing: 0,
      path,
      status: "ok",
    });
    log(`brief: ${recs.length} papers → ${path}`);
    const result: BriefResult = {
      ok: true,
      path,
      n: recs.length,
      skipped: false,
      message: `简报已生成：${recs.length} 篇`,
    };
    if (trigger === "auto") {
      for (const fn of listeners) {
        try {
          fn(result);
        } catch (e) {
          log("brief listener failed", e);
        }
      }
    }
    return result;
  } catch (e) {
    retryAt = Date.now() + RETRY_MS;
    log("brief failed", e);
    return { ok: false, n: 0, skipped: false, message: `简报生成失败：${errMsg(e)}` };
  }
}

/** Why the UI shows for the last brief, or null when none has been written yet. */
export function briefInfo() {
  const f = lastBrief();
  return {
    nextAt: nextBriefAt(),
    running: isBriefRunning(),
    last: f && f.path ? f : null,
    /** the window moved on without a file (nothing new) */
    lastEmptyAt: f && !f.path ? f.at : null,
  };
}
