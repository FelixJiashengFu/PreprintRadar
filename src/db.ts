import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { DB_PATH, DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "./config.ts";
import type { Mark, RecInfo } from "./dto.ts";
import type { ExportMode, Paper, Source, Topic } from "./types.ts";

export type { Mark, RecInfo } from "./dto.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS papers (
  uid TEXT PRIMARY KEY, source TEXT NOT NULL, ext_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL, authors TEXT NOT NULL, abstract TEXT NOT NULL, published TEXT, updated TEXT,
  categories TEXT NOT NULL DEFAULT '[]', doi TEXT, url TEXT, pdf_url TEXT, comment TEXT, journal_ref TEXT,
  license TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, query TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '["arxiv","chemrxiv"]', arxiv_cats TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT, started_at TEXT, finished_at TEXT, status TEXT,
  since TEXT, n_candidates INTEGER DEFAULT 0, n_new INTEGER DEFAULT 0, error TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS recs (
  uid TEXT PRIMARY KEY, run_id INTEGER NOT NULL, topic_ids TEXT NOT NULL DEFAULT '[]', score REAL,
  matched TEXT NOT NULL DEFAULT '[]', created_at TEXT, read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recs_run ON recs(run_id);
CREATE TABLE IF NOT EXISTS marks (
  uid TEXT PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, mode TEXT, title TEXT, n INTEGER, n_missing INTEGER,
  path TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`;

let db: DatabaseSync;

export function openDb(path = DB_PATH) {
  Deno.mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
}

const now = () => new Date().toISOString();
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const json = <T>(s: unknown, fallback: T): T => {
  try {
    return s ? JSON.parse(String(s)) as T : fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------- key/value + settings

export function kvGet<T>(k: string, fallback: T): T {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as Row | undefined;
  return row ? json<T>(row.v, fallback) : fallback;
}

export function kvSet(k: string, v: unknown) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
}

export function getSettings(): Settings {
  return sanitizeSettings(kvGet<Record<string, unknown>>("settings", {}), DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings) {
  kvSet("settings", s);
}

// ---------------------------------------------------------------- papers

function rowToPaper(r: Row): Paper {
  return {
    uid: r.uid,
    source: r.source as Source,
    extId: r.ext_id,
    version: r.version,
    title: r.title,
    authors: json<string[]>(r.authors, []),
    abstract: r.abstract,
    published: r.published,
    updated: r.updated,
    categories: json<string[]>(r.categories, []),
    doi: r.doi ?? undefined,
    url: r.url,
    pdfUrl: r.pdf_url,
    comment: r.comment ?? undefined,
    journalRef: r.journal_ref ?? undefined,
    license: r.license ?? undefined,
  };
}

/** Insert or refresh a paper; an older version never overwrites a newer one. */
export function upsertPaper(p: Paper) {
  db.prepare(`
    INSERT INTO papers (uid, source, ext_id, version, title, authors, abstract, published, updated, categories, doi,
                        url, pdf_url, comment, journal_ref, license, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      version = excluded.version, title = excluded.title, authors = excluded.authors, abstract = excluded.abstract,
      published = excluded.published, updated = excluded.updated, categories = excluded.categories,
      doi = excluded.doi, url = excluded.url, pdf_url = excluded.pdf_url, comment = excluded.comment,
      journal_ref = excluded.journal_ref, license = excluded.license, fetched_at = excluded.fetched_at
    WHERE excluded.version >= papers.version
  `).run(
    p.uid, p.source, p.extId, p.version, p.title, JSON.stringify(p.authors), p.abstract, p.published, p.updated,
    JSON.stringify(p.categories), p.doi ?? null, p.url, p.pdfUrl, p.comment ?? null, p.journalRef ?? null,
    p.license ?? null, now(),
  );
}

export function getPaper(uid: string): Paper | null {
  const r = db.prepare("SELECT * FROM papers WHERE uid = ?").get(uid) as Row | undefined;
  return r ? rowToPaper(r) : null;
}

export function getPapers(uids: string[]): Paper[] {
  return uids.map(getPaper).filter((p): p is Paper => p !== null);
}

/** Title+abstract of recently fetched papers — the corpus for document frequencies. */
export function recentPapers(limit = 1500): Paper[] {
  return (db.prepare("SELECT * FROM papers ORDER BY fetched_at DESC LIMIT ?").all(limit) as Row[]).map(rowToPaper);
}

// ---------------------------------------------------------------- topics

function rowToTopic(r: Row): Topic {
  return {
    id: r.id,
    name: r.name,
    query: r.query,
    sources: json<Source[]>(r.sources, ["arxiv", "chemrxiv"]),
    arxivCats: json<string[]>(r.arxiv_cats, []),
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTopics(): Topic[] {
  return (db.prepare("SELECT * FROM topics ORDER BY id").all() as Row[]).map(rowToTopic);
}

export function getTopic(id: number): Topic | null {
  const r = db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToTopic(r) : null;
}

export type TopicInput = Pick<Topic, "name" | "query" | "sources" | "arxivCats" | "enabled">;

export function createTopic(t: TopicInput): Topic {
  const ts = now();
  const res = db.prepare(
    "INSERT INTO topics (name, query, sources, arxiv_cats, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(t.name, t.query, JSON.stringify(t.sources), JSON.stringify(t.arxivCats), t.enabled ? 1 : 0, ts, ts);
  return getTopic(Number(res.lastInsertRowid))!;
}

export function updateTopic(id: number, t: TopicInput): Topic | null {
  db.prepare("UPDATE topics SET name = ?, query = ?, sources = ?, arxiv_cats = ?, enabled = ?, updated_at = ? WHERE id = ?")
    .run(t.name, t.query, JSON.stringify(t.sources), JSON.stringify(t.arxivCats), t.enabled ? 1 : 0, now(), id);
  return getTopic(id);
}

export function deleteTopic(id: number) {
  db.prepare("DELETE FROM topics WHERE id = ?").run(id);
}

// ---------------------------------------------------------------- runs

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

function rowToRun(r: Row): RunRow {
  return {
    id: r.id,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    since: r.since,
    nCandidates: r.n_candidates ?? 0,
    nNew: r.n_new ?? 0,
    error: r.error,
    notes: json<string[]>(r.notes, []),
  };
}

export function startRun(trigger: string, since: string): number {
  const res = db.prepare("INSERT INTO runs (trigger, started_at, status, since) VALUES (?, ?, 'running', ?)")
    .run(trigger, now(), since);
  return Number(res.lastInsertRowid);
}

export function finishRun(id: number, r: { status: string; nCandidates: number; nNew: number; error?: string; notes?: string[] }) {
  db.prepare("UPDATE runs SET finished_at = ?, status = ?, n_candidates = ?, n_new = ?, error = ?, notes = ? WHERE id = ?")
    .run(now(), r.status, r.nCandidates, r.nNew, r.error ?? null, JSON.stringify(r.notes ?? []), id);
}

/** Runs left "running" by a crash or forced quit. */
export function closeStaleRuns() {
  db.prepare("UPDATE runs SET status = 'error', error = '程序在运行中被关闭', finished_at = ? WHERE status = 'running'")
    .run(now());
}

export function lastRun(): RunRow | null {
  const r = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  return r ? rowToRun(r) : null;
}

/** Last run that actually ran (ignores "no topics yet" runs) — the scheduler's reference point. */
export function lastRealRun(): RunRow | null {
  const r = db.prepare("SELECT * FROM runs WHERE status != 'empty' ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  return r ? rowToRun(r) : null;
}

export function lastOkRun(): RunRow | null {
  const r = db.prepare("SELECT * FROM runs WHERE status IN ('ok', 'partial') ORDER BY id DESC LIMIT 1").get() as
    | Row
    | undefined;
  return r ? rowToRun(r) : null;
}

export function getRun(id: number): RunRow | null {
  const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToRun(r) : null;
}

// ---------------------------------------------------------------- recommendations


export function recommendedUids(): Set<string> {
  return new Set((db.prepare("SELECT uid FROM recs").all() as Row[]).map((r) => r.uid));
}

export function insertRec(uid: string, runId: number, topicIds: number[], score: number, matched: string[]) {
  db.prepare(
    "INSERT OR IGNORE INTO recs (uid, run_id, topic_ids, score, matched, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(uid, runId, JSON.stringify(topicIds), score, JSON.stringify(matched), now());
}

export function recInfo(uids: string[]): Map<string, RecInfo> {
  const out = new Map<string, RecInfo>();
  const stmt = db.prepare("SELECT * FROM recs WHERE uid = ?");
  for (const uid of uids) {
    const r = stmt.get(uid) as Row | undefined;
    if (r) {
      out.set(uid, {
        runId: r.run_id,
        topicIds: json<number[]>(r.topic_ids, []),
        score: r.score,
        matched: json<string[]>(r.matched, []),
        read: !!r.read,
        createdAt: r.created_at,
      });
    }
  }
  return out;
}

/** Runs that produced recommendations, newest first, each with its papers (best first). */
export function feed(opts: { limit: number; offset: number; topicId?: number; unreadOnly?: boolean }) {
  const conds = ["1 = 1"];
  const args: (string | number)[] = [];
  if (opts.topicId) {
    conds.push("EXISTS (SELECT 1 FROM json_each(recs.topic_ids) WHERE value = ?)");
    args.push(opts.topicId);
  }
  if (opts.unreadOnly) conds.push("recs.read = 0");
  const where = conds.join(" AND ");
  const runs = (db.prepare(
    `SELECT DISTINCT runs.* FROM runs JOIN recs ON recs.run_id = runs.id WHERE ${where} ORDER BY runs.id DESC LIMIT ? OFFSET ?`,
  ).all(...args, opts.limit + 1, opts.offset) as Row[]).map(rowToRun);
  const hasMore = runs.length > opts.limit;
  const stmt = db.prepare(`SELECT recs.uid FROM recs WHERE recs.run_id = ? AND ${where} ORDER BY recs.score DESC`);
  return {
    hasMore,
    batches: runs.slice(0, opts.limit).map((run) => ({
      run,
      uids: (stmt.all(run.id, ...args) as Row[]).map((r) => r.uid as string),
    })),
  };
}

export function unreadCount(): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM recs WHERE read = 0").get() as Row).n);
}

export function markRead(uids: string[]) {
  const stmt = db.prepare("UPDATE recs SET read = 1 WHERE uid = ?");
  for (const uid of uids) stmt.run(uid);
}

export function markAllRead(runId?: number) {
  if (runId) db.prepare("UPDATE recs SET read = 1 WHERE run_id = ?").run(runId);
  else db.prepare("UPDATE recs SET read = 1").run();
}

// ---------------------------------------------------------------- marks (stars / thumbs)


export function getMarks(uids: string[]): Map<string, Mark> {
  const out = new Map<string, Mark>();
  const stmt = db.prepare("SELECT rating, starred FROM marks WHERE uid = ?");
  for (const uid of uids) {
    const r = stmt.get(uid) as Row | undefined;
    if (r) out.set(uid, { rating: r.rating, starred: !!r.starred });
  }
  return out;
}

export function setMark(uid: string, patch: Partial<Mark>) {
  const cur = getMarks([uid]).get(uid) ?? { rating: 0, starred: false };
  const next = { ...cur, ...patch };
  db.prepare(`INSERT INTO marks (uid, rating, starred, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET rating = excluded.rating, starred = excluded.starred, updated_at = excluded.updated_at`)
    .run(uid, next.rating, next.starred ? 1 : 0, now());
  return next;
}

export function ratedPapers(rating: 1 | -1, limit = 300): Paper[] {
  return (db.prepare(
    "SELECT papers.* FROM marks JOIN papers ON papers.uid = marks.uid WHERE marks.rating = ? ORDER BY marks.updated_at DESC LIMIT ?",
  ).all(rating, limit) as Row[]).map(rowToPaper);
}

export function dislikedUids(): Set<string> {
  return new Set((db.prepare("SELECT uid FROM marks WHERE rating < 0").all() as Row[]).map((r) => r.uid));
}

export function starredUids(): string[] {
  return (db.prepare("SELECT uid FROM marks WHERE starred = 1 ORDER BY updated_at DESC").all() as Row[]).map((r) => r.uid);
}

// ---------------------------------------------------------------- exports

export interface ExportRow {
  id: number;
  createdAt: string;
  mode: ExportMode;
  title: string;
  n: number;
  nMissing: number;
  path: string;
  status: string;
}

export function addExport(e: Omit<ExportRow, "id" | "createdAt">): number {
  const res = db.prepare("INSERT INTO exports (created_at, mode, title, n, n_missing, path, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(now(), e.mode, e.title, e.n, e.nMissing, e.path, e.status);
  return Number(res.lastInsertRowid);
}

function rowToExport(r: Row): ExportRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode,
    title: r.title,
    n: r.n,
    nMissing: r.n_missing,
    path: r.path,
    status: r.status,
  };
}

export function listExports(limit = 100): ExportRow[] {
  return (db.prepare("SELECT * FROM exports ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(rowToExport);
}

export function getExport(id: number): ExportRow | null {
  const r = db.prepare("SELECT * FROM exports WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToExport(r) : null;
}
