/// <reference lib="dom" />
/**
 * 预印本雷达 — web version. The same UI as the desktop app (web/app.js) talks to this module instead of
 * a local server: it answers the same /api/* requests inside the browser, reaches arXiv through
 * DataCite and the other servers through Crossref (both allow cross-origin requests), and keeps the
 * visitor's topics, recommendations and stars in localStorage.
 */
import { type Extra, paperDto } from "../dto.ts";
import { errMsg, gatherCandidates, pickFair, previewTopic, searchAll, useArxivProvider } from "../engine.ts";
import { APP_ID, DOWNLOAD_URL, REPO_URL, VERSION, WEB_URL } from "../meta.ts";
import { describe, parseQuery, QueryError } from "../query.ts";
import { Profile } from "../rank.ts";
import { computeNextRun } from "../schedule.ts";
import { arxivViaDatacite } from "../sources/datacite.ts";
import { DEFAULT_SOURCES, isSource, SOURCES } from "../sources/registry.ts";
import { plainTitle } from "../text.ts";
import type { ExportMode, Paper, Topic } from "../types.ts";
import { getWebJob, startWebExport, webJobs } from "./export.ts";
import { type RunRow, sanitizeWebSettings, store } from "./store.ts";

useArxivProvider(arxivViaDatacite);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// papers seen this session (search results, previews) so stars, thumbs and exports can find them
const seen = new Map<string, Paper>();
const paperOf = (uid: string) => store.papers[uid] ?? seen.get(uid) ?? null;

function dtos(items: ({ paper: Paper } & Extra)[]) {
  return items.map(({ paper, ...extra }) => {
    seen.set(paper.uid, paper);
    return paperDto(paper, extra, store.marks[paper.uid], store.recs[paper.uid], false);
  });
}

function buildProfile(): Profile | null {
  const liked = store.rated(1);
  if (!liked.length) return null;
  return new Profile(liked, store.rated(-1), Object.values(store.papers));
}

function topicDto(t: Topic) {
  try {
    return { ...t, interpreted: describe(parseQuery(t.query)), error: "" };
  } catch (e) {
    return { ...t, interpreted: "", error: errMsg(e) };
  }
}

const CAT_RE = /^[a-z-]+(\.[A-Za-z-]+)?$/;

function topicInput(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "请给主题起个名字");
  const query = String(b.query ?? "").slice(0, 2000);
  parseQuery(query);
  const sources = [...new Set((Array.isArray(b.sources) ? b.sources : []).filter(isSource))];
  if (!sources.length) throw new HttpError(400, "至少选择一个来源");
  const arxivCats = (Array.isArray(b.arxivCats) ? b.arxivCats : []).map(String).filter((c) => CAT_RE.test(c)).slice(0, 20);
  if (!query.trim() && !(sources.includes("arxiv") && arxivCats.length)) {
    throw new HttpError(400, "请填写关键词（或为 arXiv 选择分类）");
  }
  return { name, query, sources, arxivCats, enabled: b.enabled !== false };
}

// ---------------------------------------------------------------- recommendation runs in the page

let running: Promise<void> | null = null;
let nextRunAt: number | null = null;
const loadedAt = Date.now();

function notify(title: string, body: string) {
  try {
    if (store.settings.notify && "Notification" in globalThis && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "assets/icon.png", tag: "preprint-radar" });
      n.onclick = () => {
        globalThis.focus();
        location.hash = "#/feed";
        n.close();
      };
      return true;
    }
  } catch { /* not supported */ }
  return false;
}

function run(trigger: string) {
  if (running) return running;
  running = (async () => {
    const s = store.settings;
    const topics = store.topics.filter((t) => t.enabled);
    const now = new Date();
    let sinceMs = now.getTime() - s.lookbackDays * 86_400_000;
    const lastOk = store.lastOkRun();
    if (lastOk) sinceMs = Math.min(sinceMs, Date.parse(lastOk.startedAt) - 86_400_000);
    sinceMs = Math.max(sinceMs, now.getTime() - 30 * 86_400_000);
    const r = store.startRun(trigger, new Date(sinceMs));
    if (!topics.length) {
      store.finishRun(r, { status: "empty", nCandidates: 0, nNew: 0, notes: ["还没有启用的兴趣主题"] });
      return;
    }
    const notes: string[] = [];
    try {
      const { candidates, nFetched } = await gatherCandidates(topics, new Date(sinceMs), now, buildProfile(), notes, { fresh: true });
      const disliked = new Set(Object.entries(store.marks).filter(([, m]) => m.rating < 0).map(([uid]) => uid));
      const fresh = [...candidates.values()].filter((c) =>
        !store.recs[c.paper.uid] && !disliked.has(c.paper.uid) && c.score >= s.minScore
      );
      const picked = pickFair(fresh, topics, s.maxPerRun);
      for (const c of picked) store.addRec(c.paper, r.id, c.topicIds, c.score, c.matched);
      const failedAll = nFetched === 0 && notes.length > 0;
      store.finishRun(r, {
        status: failedAll ? "error" : notes.length ? "partial" : "ok",
        nCandidates: candidates.size,
        nNew: picked.length,
        notes,
        error: failedAll ? notes.join("；") : undefined,
      });
      if (picked.length && trigger !== "manual") {
        notify(`预印本雷达：${picked.length} 篇新推荐`, picked.slice(0, 2).map((c) => "• " + plainTitle(c.paper.title)).join("\n"));
      }
    } catch (e) {
      store.finishRun(r, { status: "error", nCandidates: 0, nNew: 0, notes, error: errMsg(e) });
    }
  })().finally(() => {
    running = null;
    tick();
  });
  return running;
}

function computeNext() {
  const last = store.lastRealRun();
  const raw = computeNextRun(store.settings, last ? Date.parse(last.startedAt) : null, last?.status === "error");
  nextRunAt = raw === null || !store.topics.some((t) => t.enabled) ? null : Math.max(raw, loadedAt + 4000);
}

function tick() {
  computeNext();
  if (nextRunAt !== null && Date.now() >= nextRunAt && !running) run("schedule");
}
setInterval(tick, 30_000);
setTimeout(tick, 4000);

let soonTimer: ReturnType<typeof setTimeout> | undefined;
function runSoon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => run("manual"), 1500);
}

// ---------------------------------------------------------------- the API

function state() {
  computeNext();
  return {
    app: APP_ID,
    version: VERSION,
    web: true,
    sources: SOURCES,
    links: { repo: REPO_URL, web: WEB_URL, download: DOWNLOAD_URL },
    compiled: false,
    settings: store.settings,
    autostart: false,
    nextRunAt,
    running: running !== null,
    lastRun: store.lastRun(),
    unread: Object.values(store.recs).filter((r) => !r.read).length,
    topics: store.topics.map((t) => ({ id: t.id, name: t.name, enabled: t.enabled })),
    jobs: webJobs(),
    browsers: {},
    notificationPermission: "Notification" in globalThis ? Notification.permission : "unsupported",
  };
}

function feed(limit: number, offset: number, topicId?: number) {
  const byRun = new Map<number, string[]>();
  for (const [uid, r] of Object.entries(store.recs)) {
    if (topicId && !r.topicIds.includes(topicId)) continue;
    if (!byRun.has(r.runId)) byRun.set(r.runId, []);
    byRun.get(r.runId)!.push(uid);
  }
  const runs = store.runs.filter((r) => byRun.has(r.id)).sort((a, b) => b.id - a.id);
  return {
    hasMore: runs.length > offset + limit,
    batches: runs.slice(offset, offset + limit).map((r: RunRow) => ({
      run: r,
      papers: dtos(
        byRun.get(r.id)!
          .map((uid) => store.papers[uid])
          .filter((p): p is Paper => !!p)
          .sort((a, b) => store.recs[b.uid].score - store.recs[a.uid].score)
          .map((paper) => ({ paper })),
      ),
    })),
  };
}

async function handle(path: string, opts: { method?: string; body?: unknown }): Promise<unknown> {
  const url = new URL(path, "https://app.invalid/");
  const p = url.pathname;
  const m = (opts.method ?? "GET").toUpperCase();
  const q = url.searchParams;
  const b = (opts.body && typeof opts.body === "object" ? opts.body : {}) as Record<string, unknown>;
  try {
    if (p === "/api/state") return state();
    if (m === "PUT" && p === "/api/settings") {
      const next = sanitizeWebSettings(b, store.settings);
      let warning = "";
      if (next.notify && !store.settings.notify && "Notification" in globalThis && Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          next.notify = false;
          warning = "浏览器没有允许通知";
        }
      }
      store.settings = next;
      store.save("settings");
      tick();
      return { ...state(), warning };
    }
    if (m === "GET" && p === "/api/topics") return store.topics.map(topicDto);
    if (m === "POST" && p === "/api/topics") {
      const t = store.createTopic(topicInput(b));
      if (t.enabled) runSoon();
      return topicDto(t);
    }
    const tm = p.match(/^\/api\/topics\/(\d+)$/);
    if (tm && m === "PUT") {
      const t = store.updateTopic(Number(tm[1]), topicInput(b));
      tick();
      if (!t) throw new HttpError(404, "主题不存在");
      return topicDto(t);
    }
    if (tm && m === "DELETE") {
      store.deleteTopic(Number(tm[1]));
      tick();
      return { ok: true };
    }
    if (m === "POST" && p === "/api/topics/preview") {
      const input = topicInput({ name: "preview", ...b });
      const days = Math.min(30, Math.max(1, Number(b.days) || 7));
      const { list, nFetched, notes } = await previewTopic(input, days, buildProfile());
      return { total: list.length, nFetched, notes, days, papers: dtos(list.slice(0, 40)) };
    }
    if (m === "POST" && p === "/api/query/check") {
      try {
        return { ok: true, interpreted: describe(parseQuery(String(b.query ?? ""))) };
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    }
    if (m === "GET" && p === "/api/search") {
      const sources = [...new Set((q.get("sources") ?? "").split(",").filter(isSource))];
      const r = await searchAll({
        q: q.get("q") ?? "",
        sources: sources.length ? sources : DEFAULT_SOURCES,
        days: Number(q.get("days")) || null,
        field: (["ti", "au"].includes(q.get("field") ?? "") ? q.get("field") : "all") as "all" | "ti" | "au",
        sort: q.get("sort") === "relevance" ? "relevance" : "date",
        page: Math.max(0, Number(q.get("page")) || 0),
      }, buildProfile());
      if (sources.length) {
        store.settings.searchSources = sources;
        store.save("settings");
      }
      return {
        papers: dtos(r.results.map((x) => ({ paper: x.paper, score: x.score, matched: x.matched }))),
        hasMore: r.hasMore,
        interpreted: r.interpreted,
        notes: r.notes,
      };
    }
    if (m === "GET" && p === "/api/feed") {
      return feed(Math.min(20, Number(q.get("limit")) || 6), Number(q.get("offset")) || 0, Number(q.get("topic")) || undefined);
    }
    if (m === "POST" && p === "/api/run") {
      if (running) return { started: false, running: true };
      run(q.get("from") === "ui" ? "manual" : "schedule");
      return { started: true, running: true };
    }
    if (m === "POST" && p === "/api/schedule/toggle") {
      store.settings.scheduleEnabled = !store.settings.scheduleEnabled;
      store.save("settings");
      tick();
      return { scheduleEnabled: store.settings.scheduleEnabled };
    }
    if (m === "POST" && p === "/api/mark") {
      const paper = paperOf(String(b.uid ?? ""));
      if (!paper) throw new HttpError(404, "文章不存在");
      if (b.read === true && store.recs[paper.uid]) {
        store.recs[paper.uid].read = true;
        store.save("recs");
      }
      const patch: { rating?: number; starred?: boolean } = {};
      if (typeof b.rating === "number") patch.rating = Math.max(-1, Math.min(1, Math.round(b.rating)));
      if (typeof b.starred === "boolean") patch.starred = b.starred;
      return { ok: true, mark: Object.keys(patch).length ? store.setMark(paper, patch) : null };
    }
    if (m === "POST" && p === "/api/feed/read") {
      for (const r of Object.values(store.recs)) if (!b.runId || r.runId === Number(b.runId)) r.read = true;
      store.save("recs");
      return { ok: true };
    }
    if (m === "GET" && p === "/api/saved") {
      const uids = Object.entries(store.marks).filter(([, mk]) => mk.starred)
        .sort((x, y) => y[1].updatedAt.localeCompare(x[1].updatedAt)).map(([uid]) => uid);
      return { papers: dtos(uids.map(paperOf).filter((x): x is Paper => !!x).map((paper) => ({ paper }))) };
    }
    if (m === "POST" && p === "/api/export") {
      const papers = (Array.isArray(b.uids) ? b.uids : []).map((u) => paperOf(String(u))).filter((x): x is Paper => !!x);
      if (!papers.length) throw new HttpError(400, "请先选择文章");
      const mode = (["merged", "separate", "digest"].includes(String(b.mode)) ? b.mode : "merged") as ExportMode;
      const title = typeof b.title === "string" && b.title.trim() ? b.title.trim() : `文献合集（${papers.length}篇）`;
      return startWebExport(papers, mode, title, (uid) => store.recs[uid]?.matched);
    }
    const jm = p.match(/^\/api\/jobs\/([\w-]+)/);
    if (jm) return getWebJob(jm[1]) ?? Promise.reject(new HttpError(404, "任务不存在"));
    if (p === "/api/exports") return [];
    if (m === "POST" && p === "/api/open") {
      if (b.kind === "url" && /^https?:\/\//.test(String(b.target))) globalThis.open(String(b.target), "_blank", "noopener");
      return { ok: true };
    }
    if (m === "POST" && p === "/api/notify-test") {
      if (!("Notification" in globalThis)) return { ok: false };
      if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return { ok: false };
      const prev = store.settings.notify;
      store.settings.notify = true;
      const ok = notify("预印本雷达：测试通知", "页面开着时，自动推荐有新文章会这样提醒你。");
      store.settings.notify = prev;
      return { ok };
    }
    return {};
  } catch (e) {
    if (e instanceof QueryError) throw new HttpError(400, e.message);
    throw e;
  }
}

/** Answer like a server: a fresh copy every time, never live objects from the store (the UI compares snapshots). */
async function request(path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> {
  return structuredClone(await handle(path, opts));
}

(globalThis as unknown as { radarWeb: unknown }).radarWeb = { request };
