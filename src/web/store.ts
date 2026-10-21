/// <reference lib="dom" />
/** The web version keeps everything in the visitor's own browser (localStorage), nothing on a server. */
import type { Mark, RecInfo } from "../dto.ts";
import { MIN_INTERVAL_MINUTES, type ScheduleSettings } from "../schedule.ts";
import { DEFAULT_SOURCES, isSource } from "../sources/registry.ts";
import type { Paper, Source, Topic } from "../types.ts";

export interface WebSettings extends ScheduleSettings {
  lookbackDays: number;
  maxPerRun: number;
  minScore: number;
  /** browser notifications when a run finds something while the page is open */
  notify: boolean;
  searchSources: Source[];
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  scheduleEnabled: true,
  scheduleMode: "interval",
  intervalValue: 6,
  intervalUnit: "hours",
  dailyTime: "08:30",
  lookbackDays: 4,
  maxPerRun: 20,
  minScore: 25,
  notify: false,
  searchSources: DEFAULT_SOURCES,
};

export interface RunRow {
  id: number;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  since: string | null;
  nCandidates: number;
  nNew: number;
  error: string | null;
  notes: string[];
}

const PREFIX = "radar1:";
const MAX_RUNS = 60;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) as T : fallback;
  } catch {
    return fallback;
  }
}

export function sanitizeWebSettings(input: Record<string, unknown>, base: WebSettings): WebSettings {
  const s = { ...base };
  const int = (k: "intervalValue" | "lookbackDays" | "maxPerRun" | "minScore", min: number, max: number) => {
    const v = Number(input[k]);
    if (input[k] !== undefined && input[k] !== "" && Number.isFinite(v)) s[k] = Math.min(max, Math.max(min, Math.round(v)));
  };
  if (typeof input.scheduleEnabled === "boolean") s.scheduleEnabled = input.scheduleEnabled;
  if (input.scheduleMode === "interval" || input.scheduleMode === "daily") s.scheduleMode = input.scheduleMode;
  if (["minutes", "hours", "days"].includes(String(input.intervalUnit))) s.intervalUnit = input.intervalUnit as WebSettings["intervalUnit"];
  if (typeof input.dailyTime === "string" && /^\d{1,2}:\d{2}$/.test(input.dailyTime)) s.dailyTime = input.dailyTime.padStart(5, "0");
  if (typeof input.notify === "boolean") s.notify = input.notify;
  if (Array.isArray(input.searchSources)) {
    const src = input.searchSources.filter(isSource);
    if (src.length) s.searchSources = src;
  }
  int("intervalValue", 1, 999);
  int("lookbackDays", 1, 30);
  int("maxPerRun", 1, 200);
  int("minScore", 0, 100);
  if (s.intervalUnit === "minutes" && s.intervalValue < MIN_INTERVAL_MINUTES) s.intervalValue = MIN_INTERVAL_MINUTES;
  return s;
}

class Store {
  settings = sanitizeWebSettings(read("settings", {}), DEFAULT_WEB_SETTINGS);
  topics: Topic[] = read("topics", []);
  runs: RunRow[] = read("runs", []);
  recs: Record<string, RecInfo> = read("recs", {});
  papers: Record<string, Paper> = read("papers", {});
  marks: Record<string, Mark & { updatedAt: string }> = read("marks", {});

  save(...keys: ("settings" | "topics" | "runs" | "recs" | "papers" | "marks")[]) {
    for (const k of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          localStorage.setItem(PREFIX + k, JSON.stringify(this[k]));
          break;
        } catch {
          // quota: drop the oldest recommendation batches and try again
          this.prune(Math.floor(this.runs.length / 2));
        }
      }
    }
  }

  prune(keepRuns = MAX_RUNS) {
    if (this.runs.length > keepRuns) this.runs = this.runs.slice(-keepRuns);
    const runIds = new Set(this.runs.map((r) => r.id));
    for (const [uid, r] of Object.entries(this.recs)) if (!runIds.has(r.runId)) delete this.recs[uid];
    for (const uid of Object.keys(this.papers)) if (!this.recs[uid] && !this.marks[uid]) delete this.papers[uid];
  }

  // ------------------------------------------------------------ topics
  createTopic(t: Omit<Topic, "id" | "createdAt" | "updatedAt">): Topic {
    const now = new Date().toISOString();
    const topic = { ...t, id: Math.max(0, ...this.topics.map((x) => x.id)) + 1, createdAt: now, updatedAt: now };
    this.topics.push(topic);
    this.save("topics");
    return topic;
  }

  updateTopic(id: number, t: Omit<Topic, "id" | "createdAt" | "updatedAt">): Topic | null {
    const i = this.topics.findIndex((x) => x.id === id);
    if (i < 0) return null;
    this.topics[i] = { ...this.topics[i], ...t, updatedAt: new Date().toISOString() };
    this.save("topics");
    return this.topics[i];
  }

  deleteTopic(id: number) {
    this.topics = this.topics.filter((t) => t.id !== id);
    this.save("topics");
  }

  // ------------------------------------------------------------ runs
  startRun(trigger: string, since: Date): RunRow {
    const run: RunRow = {
      id: Math.max(0, ...this.runs.map((r) => r.id)) + 1,
      trigger,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: "running",
      since: since.toISOString(),
      nCandidates: 0,
      nNew: 0,
      error: null,
      notes: [],
    };
    this.runs.push(run);
    this.save("runs");
    return run;
  }

  finishRun(run: RunRow, r: Pick<RunRow, "status" | "nCandidates" | "nNew" | "notes"> & { error?: string }) {
    Object.assign(run, r, { finishedAt: new Date().toISOString(), error: r.error ?? null });
    this.prune();
    this.save("runs", "recs", "papers");
  }

  lastRun = () => this.runs[this.runs.length - 1] ?? null;
  lastRealRun = () => [...this.runs].reverse().find((r) => r.status !== "empty" && r.status !== "running") ?? null;
  lastOkRun = () => [...this.runs].reverse().find((r) => r.status === "ok" || r.status === "partial") ?? null;

  // ------------------------------------------------------------ recommendations, marks, papers
  addRec(p: Paper, runId: number, topicIds: number[], score: number, matched: string[]) {
    if (this.recs[p.uid]) return;
    this.papers[p.uid] = p;
    this.recs[p.uid] = { runId, topicIds, score, matched, read: false, createdAt: new Date().toISOString() };
  }

  setMark(p: Paper, patch: Partial<Mark>): Mark {
    const cur = this.marks[p.uid] ?? { rating: 0, starred: false, updatedAt: "" };
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    if (!next.rating && !next.starred) delete this.marks[p.uid];
    else {
      this.marks[p.uid] = next;
      this.papers[p.uid] = p;
    }
    this.save("marks", "papers");
    return { rating: next.rating, starred: next.starred };
  }

  rated(rating: 1 | -1): Paper[] {
    return Object.entries(this.marks)
      .filter(([, m]) => m.rating === rating)
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([uid]) => this.papers[uid])
      .filter((p): p is Paper => !!p)
      .slice(0, 300);
  }
}

export const store = new Store();
