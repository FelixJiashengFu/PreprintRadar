import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { APP_ID, APP_NAME, ASSET_DIR, DATA_DIR, sanitizeSettings, VERSION, WEB_DIR } from "./config.ts";
import * as db from "./db.ts";
import { type Extra, paperDto } from "./dto.ts";
import { cachedPdf, getJob, type Job, MODE_LABEL, recentJobs, skipWait, startExport, storePdf } from "./exporter.ts";
import { log, LOG_PATH } from "./log.ts";
import { describe, parseQuery, QueryError, toArxiv } from "./query.ts";
import { errMsg, isRunning, previewTopic, runRecommendation } from "./recommend.ts";
import { getNextRunAt, requestRunSoon, tick } from "./scheduler.ts";
import { search } from "./search.ts";
import {
  autostartEnabled,
  findBrowser,
  isCompiled,
  openAppWindow,
  openPath,
  openUrl,
  pickFolder,
  revealPath,
  setAutostart,
  showToast,
} from "./system.ts";
import { DOWNLOAD_URL, REPO_URL, WEB_URL } from "./meta.ts";
import { DEFAULT_SOURCES, isSource, SOURCES } from "./sources/registry.ts";
import { takeBalloons } from "./tray.ts";
import type { ExportMode, Paper, Topic } from "./types.ts";

export interface ServerCtx {
  port: number;
  iconPng: string;
  quit: () => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** ASCII-only JSON: Windows PowerShell 5.1 (the tray) then decodes it correctly whatever it assumes. */
function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const fail = (message: string, status = 400) => json({ error: message }, status);

class BadRequest extends Error {}

// ---------------------------------------------------------------- DTOs

function paperDtos(items: ({ paper: Paper } & Extra)[]) {
  const uids = items.map((i) => i.paper.uid);
  const marks = db.getMarks(uids);
  const recs = db.recInfo(uids);
  return items.map(({ paper, ...extra }) =>
    paperDto(paper, extra, marks.get(paper.uid), recs.get(paper.uid), !!cachedPdf(paper))
  );
}

function jobDto(j: Job) {
  const count = (s: string) => j.items.filter((i) => i.state === s).length;
  return {
    id: j.id,
    mode: j.mode,
    modeLabel: MODE_LABEL[j.mode],
    title: j.title,
    status: j.status,
    auto: j.auto,
    total: j.items.length,
    ready: count("ready"),
    browser: count("browser"),
    failed: count("failed"),
    pending: count("pending"),
    items: j.items.map((i) => ({ uid: i.uid, title: i.title, source: i.source, state: i.state, note: i.note })),
    output: j.output,
    message: j.message,
    waitLeftMs: j.waitUntil ? Math.max(0, j.waitUntil - Date.now()) : 0,
    finishedAt: j.finishedAt,
  };
}

function topicDto(t: Topic) {
  let interpreted = "";
  let error = "";
  try {
    interpreted = describe(parseQuery(t.query));
  } catch (e) {
    error = errMsg(e);
  }
  return { ...t, interpreted, error };
}

const CAT_RE = /^[a-z-]+(\.[A-Za-z-]+)?$/;

function topicInput(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) throw new BadRequest("请给主题起个名字");
  const query = String(b.query ?? "").slice(0, 2000);
  parseQuery(query); // throws QueryError
  const sources = [...new Set((Array.isArray(b.sources) ? b.sources : []).filter(isSource))];
  if (!sources.length) throw new BadRequest("至少选择一个来源");
  const arxivCats = (Array.isArray(b.arxivCats) ? b.arxivCats : []).map(String).filter((c) => CAT_RE.test(c)).slice(0, 20);
  if (!query.trim() && !(sources.includes("arxiv") && arxivCats.length)) {
    throw new BadRequest("请填写关键词（或为 arXiv 选择分类）");
  }
  return { name, query, sources, arxivCats, enabled: b.enabled !== false };
}

// ---------------------------------------------------------------- state for the UI and the tray

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function appState() {
  const s = db.getSettings();
  return {
    app: APP_ID,
    version: VERSION,
    web: false,
    sources: SOURCES,
    links: { repo: REPO_URL, web: WEB_URL, download: DOWNLOAD_URL },
    dataDir: DATA_DIR,
    logPath: LOG_PATH,
    compiled: isCompiled(),
    settings: s,
    autostart: autostartEnabled(),
    nextRunAt: getNextRunAt(),
    running: isRunning(),
    lastRun: db.lastRun(),
    unread: db.unreadCount(),
    topics: db.listTopics().map((t) => ({ id: t.id, name: t.name, enabled: t.enabled })),
    jobs: recentJobs().map(jobDto),
    browsers: { edge: !!findBrowser("edge"), chrome: !!findBrowser("chrome") },
  };
}

function trayState() {
  const s = db.getSettings();
  const next = getNextRunAt();
  const unread = db.unreadCount();
  let tooltip = APP_NAME;
  if (isRunning()) tooltip += " · 正在推荐…";
  else if (!s.scheduleEnabled) tooltip += " · 自动推荐已暂停";
  else if (next) tooltip += ` · 下次 ${fmtWhen(next)}`;
  if (unread) tooltip += ` · ${unread} 篇未读`;
  return {
    tooltip: tooltip.slice(0, 63),
    running: isRunning(),
    labels: {
      open: "打开预印本雷达",
      run: isRunning() ? "正在推荐…" : "立即推荐一次",
      pause: s.scheduleEnabled ? "暂停自动推荐" : "恢复自动推荐",
      quit: "退出",
    },
    balloons: takeBalloons(),
  };
}

/** Only paths the app itself produced may be opened from the UI. */
function allowedPath(target: string): boolean {
  if (!isAbsolute(target)) return false;
  const roots = [db.getSettings().exportDir, DATA_DIR, ...db.listExports(500).map((e) => e.path)];
  return roots.some((root) => {
    const rel = relative(normalize(root), normalize(target));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

// ---------------------------------------------------------------- routes

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

async function api(req: Request, url: URL, ctx: ServerCtx): Promise<Response> {
  const path = url.pathname;
  const m = req.method;
  const q = url.searchParams;

  if (m === "GET" && path === "/api/ping") return json({ app: APP_ID, version: VERSION });
  if (m === "GET" && path === "/api/state") return json(appState());

  if (m === "PUT" && path === "/api/settings") {
    const before = db.getSettings();
    const next = sanitizeSettings(await readJson(req), before);
    let warning = "";
    if (next.autostart !== autostartEnabled()) {
      const ok = await setAutostart(next.autostart);
      if (!ok) {
        next.autostart = false;
        warning = "开机启动需要使用打包好的 PreprintRadar.exe";
      }
    }
    db.saveSettings(next);
    tick();
    return json({ ...appState(), warning });
  }

  // topics
  if (m === "GET" && path === "/api/topics") return json(db.listTopics().map(topicDto));
  if (m === "POST" && path === "/api/topics") {
    const t = db.createTopic(topicInput(await readJson(req)));
    if (t.enabled) requestRunSoon();
    else tick();
    return json(topicDto(t));
  }
  const topicMatch = path.match(/^\/api\/topics\/(\d+)$/);
  if (topicMatch && m === "PUT") {
    const t = db.updateTopic(Number(topicMatch[1]), topicInput(await readJson(req)));
    tick();
    return t ? json(topicDto(t)) : fail("主题不存在", 404);
  }
  if (topicMatch && m === "DELETE") {
    db.deleteTopic(Number(topicMatch[1]));
    tick();
    return json({ ok: true });
  }
  if (m === "POST" && path === "/api/topics/preview") {
    const b = await readJson(req);
    const input = topicInput({ name: "preview", ...b });
    const days = Math.min(30, Math.max(1, Number(b.days) || 7));
    const { list, nFetched, notes } = await previewTopic(input, days);
    return json({
      total: list.length,
      nFetched,
      notes,
      days,
      papers: paperDtos(list.slice(0, 40)),
    });
  }
  if (m === "POST" && path === "/api/query/check") {
    const b = await readJson(req);
    try {
      const ast = parseQuery(String(b.query ?? ""));
      return json({ ok: true, interpreted: describe(ast), arxiv: toArxiv(ast) });
    } catch (e) {
      return json({ ok: false, error: errMsg(e) });
    }
  }

  // search
  if (m === "GET" && path === "/api/search") {
    const sources = [...new Set((q.get("sources") ?? "").split(",").filter(isSource))];
    const days = Number(q.get("days")) || null;
    const r = await search({
      q: q.get("q") ?? "",
      sources: sources.length ? sources : DEFAULT_SOURCES,
      days,
      field: (["ti", "au"].includes(q.get("field") ?? "") ? q.get("field") : "all") as "all" | "ti" | "au",
      sort: q.get("sort") === "relevance" ? "relevance" : "date",
      page: Math.max(0, Number(q.get("page")) || 0),
    });
    return json({
      papers: paperDtos(r.results.map((x) => ({ paper: x.paper, score: x.score, matched: x.matched }))),
      hasMore: r.hasMore,
      interpreted: r.interpreted,
      notes: r.notes,
    });
  }

  // recommendations
  if (m === "GET" && path === "/api/feed") {
    const f = db.feed({
      limit: Math.min(20, Number(q.get("limit")) || 6),
      offset: Number(q.get("offset")) || 0,
      topicId: Number(q.get("topic")) || undefined,
      unreadOnly: q.get("unread") === "1",
    });
    return json({
      hasMore: f.hasMore,
      batches: f.batches.map((b) => ({ run: b.run, papers: paperDtos(db.getPapers(b.uids).map((paper) => ({ paper }))) })),
    });
  }
  if (m === "POST" && path === "/api/run") {
    if (isRunning()) return json({ started: false, running: true });
    const trigger = q.get("from") === "ui" ? "manual" : "tray";
    runRecommendation(trigger).catch((e) => log("run failed", e));
    return json({ started: true, running: true });
  }
  if (m === "POST" && path === "/api/schedule/toggle") {
    const s = db.getSettings();
    db.saveSettings({ ...s, scheduleEnabled: !s.scheduleEnabled });
    tick();
    return json({ scheduleEnabled: !s.scheduleEnabled });
  }

  // marks
  if (m === "POST" && path === "/api/mark") {
    const b = await readJson(req);
    const uid = String(b.uid ?? "");
    if (!db.getPaper(uid)) return fail("文章不存在", 404);
    if (b.read === true) db.markRead([uid]);
    const patch: { rating?: number; starred?: boolean } = {};
    if (typeof b.rating === "number") patch.rating = Math.max(-1, Math.min(1, Math.round(b.rating)));
    if (typeof b.starred === "boolean") patch.starred = b.starred;
    const mark = Object.keys(patch).length ? db.setMark(uid, patch) : null;
    return json({ ok: true, mark });
  }
  if (m === "POST" && path === "/api/feed/read") {
    const b = await readJson(req);
    db.markAllRead(Number(b.runId) || undefined);
    return json({ ok: true, unread: db.unreadCount() });
  }
  if (m === "GET" && path === "/api/saved") {
    return json({ papers: paperDtos(db.getPapers(db.starredUids()).map((paper) => ({ paper }))) });
  }

  // export
  if (m === "POST" && path === "/api/export") {
    const b = await readJson(req);
    const uids = (Array.isArray(b.uids) ? b.uids : []).map(String).slice(0, 200);
    const mode = (["merged", "separate", "digest"].includes(String(b.mode)) ? b.mode : "merged") as ExportMode;
    if (!uids.length) return fail("请先选择文章");
    return json(jobDto(startExport(uids, mode, typeof b.title === "string" ? b.title : undefined)));
  }
  const jobMatch = path.match(/^\/api\/jobs\/([\w-]+)(\/skip)?$/);
  if (jobMatch) {
    const job = getJob(jobMatch[1]);
    if (!job) return fail("任务不存在", 404);
    if (m === "POST" && jobMatch[2]) skipWait(job.id);
    return json(jobDto(job));
  }
  if (m === "GET" && path === "/api/exports") {
    return json(db.listExports(200).map((e) => ({ ...e, exists: (() => {
      try {
        Deno.statSync(e.path);
        return true;
      } catch {
        return false;
      }
    })() })));
  }
  if (m === "POST" && path === "/api/pdf") {
    const p = db.getPaper(q.get("uid") ?? "");
    if (!p) return fail("文章不存在", 404);
    storePdf(p, new Uint8Array(await req.arrayBuffer()));
    return json({ ok: true });
  }

  // desktop integration
  if (m === "POST" && path === "/api/open") {
    const b = await readJson(req);
    const target = String(b.target ?? "");
    if (b.kind === "url") openUrl(target);
    else if (b.kind === "pdf") {
      const p = db.getPaper(target);
      const f = p && cachedPdf(p);
      if (!f) return fail("本地还没有这篇的 PDF", 404);
      openPath(f);
    } else {
      if (!allowedPath(target)) return fail("不允许打开这个位置", 403);
      if (b.kind === "reveal") revealPath(target);
      else openPath(target);
    }
    return json({ ok: true });
  }
  if (m === "POST" && path === "/api/pick-folder") {
    const b = await readJson(req);
    const picked = await pickFolder(String(b.initial ?? ""), String(b.title ?? "选择文件夹"));
    return json({ path: picked });
  }
  if (m === "POST" && path === "/api/notify-test") {
    const ok = await showToast(
      `${APP_NAME}：测试通知`,
      "自动推荐有新文章时，会像这样提醒你。点击可打开推荐列表。",
      `http://127.0.0.1:${ctx.port}/#/feed`,
      ctx.iconPng,
    );
    return json({ ok });
  }
  if (m === "POST" && path === "/api/window") {
    const route = /^[a-z]+$/.test(q.get("route") ?? "") ? q.get("route") : "feed";
    openAppWindow(`http://127.0.0.1:${ctx.port}/#/${route}`, db.getSettings().uiBrowser);
    return json({ ok: true });
  }
  if (m === "POST" && path === "/api/tray") return json(trayState());
  if (m === "POST" && path === "/api/quit") {
    setTimeout(ctx.quit, 200);
    return json({ ok: true });
  }
  return fail("not found", 404);
}

async function serveStatic(pathname: string): Promise<Response> {
  const [root, rel] = pathname.startsWith("/assets/")
    ? [ASSET_DIR, pathname.slice("/assets/".length)]
    : [WEB_DIR, pathname === "/" ? "index.html" : pathname.slice(1)];
  const file = normalize(join(root, decodeURIComponent(rel)));
  const r = relative(root, file);
  if (r.startsWith("..") || isAbsolute(r)) return new Response("not found", { status: 404 });
  try {
    const body = await Deno.readFile(file);
    return new Response(body, {
      headers: { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

export function makeHandler(ctx: ServerCtx) {
  const hosts = new Set([`127.0.0.1:${ctx.port}`, `localhost:${ctx.port}`]);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // DNS-rebinding and CSRF guards: only our own origin, and a custom header on writes
    if (!hosts.has(req.headers.get("host") ?? "")) return new Response("forbidden", { status: 403 });
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.get("origin");
      if (req.headers.get("x-radar") !== "1" || (origin && !hosts.has(origin.replace(/^https?:\/\//, "")))) {
        return fail("forbidden", 403);
      }
    }
    try {
      return url.pathname.startsWith("/api/") ? await api(req, url, ctx) : await serveStatic(url.pathname);
    } catch (e) {
      if (e instanceof QueryError || e instanceof BadRequest) return fail(e.message, 400);
      log("request failed", req.method, url.pathname, e);
      return fail(errMsg(e), 500);
    }
  };
}
