// 预印本雷达 — UI. Talks to the local server (src/server.ts); no build step.
// deno-lint-ignore-file no-window no-window-prefix -- browser code: `window` is right here

// ---------------------------------------------------------------- helpers

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const main = $("#main");
const modal = $("#modal");
/** The web version (radar-web.js) answers the same /api/* requests inside the browser. */
const WEB = !!window.radarWeb;

async function api(path, { method = "GET", body, raw } = {}) {
  if (WEB) {
    try {
      return await window.radarWeb.request(path, { method, body: raw ? undefined : body });
    } catch (e) {
      throw new Error(e?.message || String(e));
    }
  }
  const headers = { "X-Radar": "1" };
  if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), err ? 6500 : 3200);
}
const fail = (e) => toast(e?.message || String(e), true);

const ICONS = {
  feed: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="m12 12 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.4"/>',
  star: '<path d="m12 3.2 2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.4 2.8 1-6L3.3 9.6l6-.9z"/>',
  download: '<path d="M12 3.5v11.5"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 20.5h15"/>',
  sliders:
    '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2.2h7.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  up: '<path d="M7 10.5v9.5H4v-9.5z"/><path d="m7 10.5 4-7.5a2 2 0 0 1 3 2.1l-.9 4.4h5.6a2 2 0 0 1 2 2.4l-1.3 6.5a2 2 0 0 1-2 1.6H7"/>',
  down: '<g transform="rotate(180 12 12)"><path d="M7 10.5v9.5H4v-9.5z"/><path d="m7 10.5 4-7.5a2 2 0 0 1 3 2.1l-.9 4.4h5.6a2 2 0 0 1 2 2.4l-1.3 6.5a2 2 0 0 1-2 1.6H7"/></g>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8.5"/><path d="M20.5 3.5v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checks: '<path d="m2.5 12.5 4.5 4.5 9.5-10"/><path d="m12.5 16 1.5 1.5 8-9"/>',
  chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9"/><path d="M10.3 20.5a1.9 1.9 0 0 0 3.4 0"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><path d="M12 17h.01"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
};
const I = (name) => `<svg class="i" viewBox="0 0 24 24">${ICONS[name] ?? ""}</svg>`;

const pad = (n) => String(n).padStart(2, "0");
const WEEK = "日一二三四五六";
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(d) {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 864e5);
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
}
const fmtWhen = (ts) => {
  const d = new Date(ts);
  return `${dayLabel(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function fmtIn(ts) {
  const m = Math.round((ts - Date.now()) / 60000);
  if (m <= 1) return "马上开始";
  if (m < 60) return `${m} 分钟后`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时${m % 60 ? ` ${m % 60} 分` : ""}后`;
  return `${Math.round(h / 24)} 天后`;
}
const UNIT = { minutes: "分钟", hours: "小时", days: "天" };
const scheduleText = (s) =>
  !s.scheduleEnabled ? "已暂停" : s.scheduleMode === "daily" ? `每天 ${s.dailyTime}` : `每 ${s.intervalValue} ${UNIT[s.intervalUnit]}`;
const TRIGGER = { schedule: "自动推荐", manual: "手动推荐", tray: "从托盘推荐" };
const MODE = { merged: "合并PDF", separate: "逐篇PDF", digest: "摘要清单" };

// preprint servers come from the backend (src/sources/registry.ts)
const sources = () => state.app?.sources ?? [];
const srcName = (id) => sources().find((s) => s.id === id)?.name ?? id;
const defaultSources = () => sources().filter((s) => s.default).map((s) => s.id);

function ensureSourceStyles() {
  if ($("#src-colors") || !sources().length) return;
  const el = document.createElement("style");
  el.id = "src-colors";
  el.textContent = sources().map((s) => `.src.${s.id}{--c:${s.color}}`).join("") +
    `@media (prefers-color-scheme: dark){${sources().map((s) => `.src.${s.id}{--c:${s.dark}}`).join("")}}`;
  document.head.append(el);
}

/** Toggleable chips for choosing preprint servers; `id` names the container. */
function sourceChips(id, selected) {
  return `<div class="chips" id="${id}">${
    sources().map((s) =>
      `<span class="chip src-chip${selected.includes(s.id) ? " on" : ""}" data-src="${s.id}" title="${esc(s.field)}${
        s.pdf === "browser" ? "（PDF 需在浏览器中下载）" : ""
      }">${esc(s.name)}</span>`
    ).join("")
  }<span class="chip ghost-chip" data-src-preset="default" title="arXiv、ChemRxiv、bioRxiv 等常用来源">常用</span><span class="chip ghost-chip" data-src-preset="all">全部</span></div>`;
}

function chipClick(e) {
  const chip = e.target.closest("[data-src]");
  if (chip) {
    chip.classList.toggle("on");
    return true;
  }
  const preset = e.target.closest("[data-src-preset]");
  if (!preset) return false;
  const want = preset.dataset.srcPreset === "all" ? sources().map((s) => s.id) : defaultSources();
  for (const c of $$("[data-src]", preset.parentElement)) c.classList.toggle("on", want.includes(c.dataset.src));
  return true;
}
const chosenSources = (id) => $$(`#${id} .chip.on[data-src]`).map((c) => c.dataset.src);

function rememberSearchSources(list) {
  try {
    localStorage.setItem("radar.searchSources", JSON.stringify(list));
  } catch { /* private mode */ }
}
function rememberedSearchSources() {
  try {
    const v = JSON.parse(localStorage.getItem("radar.searchSources") ?? "null");
    if (Array.isArray(v) && v.length) return v;
  } catch { /* ignore */ }
  return null;
}

const ARXIV_CATS = [
  ["physics.chem-ph", "化学物理"],
  ["cond-mat.mtrl-sci", "材料科学"],
  ["cond-mat.soft", "软物质"],
  ["physics.comp-ph", "计算物理"],
  ["physics.bio-ph", "生物物理"],
  ["q-bio.BM", "生物分子"],
  ["q-bio.QM", "定量生物方法"],
  ["cs.LG", "机器学习"],
  ["cs.AI", "人工智能"],
  ["stat.ML", "统计学习"],
  ["quant-ph", "量子物理"],
  ["cond-mat.stat-mech", "统计力学"],
  ["physics.atom-ph", "原子分子物理"],
  ["physics.app-ph", "应用物理"],
];

const TEMPLATES = [
  {
    name: "AI × 化学",
    query:
      '("machine learning", "deep learning", "neural network*", "language model*", "foundation model*", generative) (molecul*, chemi*, reaction*, catalys*, polymer*, crystal*, "drug discovery", "materials discovery", "materials design")',
    sources: ["arxiv", "chemrxiv", "biorxiv", "researchsquare", "preprints"],
    arxivCats: ["physics.chem-ph", "cond-mat.mtrl-sci", "cs.LG", "q-bio.BM"],
  },
  {
    name: "有机合成方法学",
    query:
      '"C-H activation", "C-H functionalization", photoredox, electrosynthesis, "asymmetric catalysis", "cross-coupling", "total synthesis"',
    sources: ["chemrxiv", "beilstein", "researchsquare", "preprints", "arxiv"],
    arxivCats: [],
  },
  {
    name: "有机反应机理",
    query:
      '"reaction mechanism*", "mechanistic stud*", "kinetic isotope effect*", "transition state*", Hammett, "radical clock*"',
    sources: ["chemrxiv", "beilstein", "researchsquare", "arxiv"],
    arxivCats: ["physics.chem-ph"],
  },
  {
    name: "催化与能源材料",
    query:
      'electrocatal*, photocatal*, "CO2 reduction", "oxygen evolution", "hydrogen evolution", "single-atom", "lithium-ion", "solid-state electrolyte*"',
    sources: ["arxiv", "chemrxiv", "researchsquare", "preprints"],
    arxivCats: ["cond-mat.mtrl-sci", "physics.chem-ph"],
  },
  {
    name: "计算化学 / DFT",
    query:
      'DFT, "density functional", "ab initio", "molecular dynamics", "force field*", "machine-learned potential*", "coupled cluster"',
    sources: ["arxiv", "chemrxiv", "researchsquare", "preprints"],
    arxivCats: ["physics.chem-ph", "physics.comp-ph", "cond-mat.mtrl-sci"],
  },
  {
    name: "化学生物学 / 药物发现",
    query:
      '"drug discovery", "chemical biology", "medicinal chemistry", "covalent inhibitor*", PROTAC*, "fragment-based", "binding affinity"',
    sources: ["biorxiv", "chemrxiv", "researchsquare", "medrxiv"],
    arxivCats: [],
  },
];

// ---------------------------------------------------------------- state

const state = {
  app: null,
  route: "feed",
  handlers: {},
  papers: new Map(), // uid → paper shown somewhere
  selection: new Map(), // uid → paper
  batches: new Map(), // run id → uids
  topicNames: new Map(),
  dismissed: new Set(),
  feedTopic: 0,
  feedOffset: 0,
  search: { q: "", sources: null, days: "30", field: "all", sort: "date", results: [], page: 0 },
};

// ---------------------------------------------------------------- polling, sidebar, jobs

let pollTimer = 0;
let booted = false; // the first poll only learns the current state
async function poll() {
  clearTimeout(pollTimer);
  const before = state.app?.lastRun;
  try {
    state.app = await api("/api/state");
    ensureSourceStyles();
    for (const t of state.app.topics) state.topicNames.set(t.id, t.name);
    renderSide();
    renderJobs();
    // a run finished since the last poll (even one too short to be seen running)
    const last = state.app.lastRun;
    if (booted && last?.finishedAt && (!before || before.id !== last.id || !before.finishedAt)) runFinished();
    booted = true;
    if (state.route === "feed") renderStrip();
    if (state.route === "settings") renderNext();
  } catch { /* server restarting */ }
  const busy = state.app?.running || state.app?.jobs.some((j) => !["done", "error"].includes(j.status));
  pollTimer = setTimeout(poll, busy ? 1000 : 4000);
}

function runFinished() {
  const r = state.app.lastRun;
  if (r) {
    if (r.status === "error") toast(`推荐失败：${r.error || "未知原因"}`, true);
    else if (r.nNew) toast(`新推荐 ${r.nNew} 篇`);
    else toast("这次没有新的匹配文章");
  }
  if (state.route === "feed") loadFeed(false).catch(fail);
}

const NAV = [
  ["feed", "feed", "推荐"],
  ["search", "search", "搜索"],
  ["topics", "tag", "兴趣主题"],
  ["saved", "star", "收藏"],
  ["exports", "history", "导出记录"],
  ["settings", "sliders", "设置"],
];

function renderSide() {
  const a = state.app;
  $("#nav").innerHTML = NAV.filter(([r]) => !(WEB && r === "exports")).map(([r, icon, label]) =>
    `<a href="#/${r}" data-route="${r}" class="${state.route === r ? "active" : ""}">${I(icon)}<span>${label}</span>` +
    (r === "feed" && a?.unread ? `<span class="count">${a.unread}</span>` : "") + "</a>"
  ).join("");
  if (!a) return;
  const s = a.settings;
  let line;
  if (a.running) line = `<div class="row"><span class="dot busy"></span>正在推荐…</div>`;
  else if (!s.scheduleEnabled) line = `<div class="row"><span class="dot"></span>自动推荐已暂停</div>`;
  else if (!a.topics.some((t) => t.enabled)) line = `<div class="row"><span class="dot"></span>等待添加兴趣主题</div>`;
  else {
    line = `<div class="row"><span class="dot on"></span>自动推荐 · ${scheduleText(s)}</div>` +
      (a.nextRunAt ? `<div>下次：${fmtWhen(a.nextRunAt)}</div>` : "");
  }
  $("#side-foot").innerHTML = line + (WEB
    ? `<div class="web-links">网页版 · <a href="${esc(a.links.download)}" target="_blank" rel="noopener">下载桌面版</a> · ` +
      `<a href="${esc(a.links.repo)}" target="_blank" rel="noopener">GitHub</a></div>`
    : "");
}

function renderJobs() {
  // newest three; finished ones fade out after five minutes (they stay listed under 导出记录)
  const jobs = (state.app?.jobs ?? []).filter((j) =>
    !state.dismissed.has(j.id) && !(j.finishedAt && Date.now() - Date.parse(j.finishedAt) > 5 * 60_000)
  ).slice(0, 3);
  $("#jobs").innerHTML = jobs.map(jobCard).join("");
}

function jobCard(j) {
  const busy = !["done", "error"].includes(j.status);
  const pct = Math.round((100 * (j.ready + j.failed)) / Math.max(1, j.total));
  let msg = "";
  let cls = "";
  if (j.status === "running") msg = j.mode === "digest" ? "正在整理…" : `正在下载 PDF：${j.ready + j.failed}/${j.total}`;
  else if (j.status === "waiting") {
    cls = "warn";
    msg = `ChemRxiv 只允许浏览器下载 PDF：已在浏览器中打开 ${j.browser} 篇，请在每个标签页点「下载」或按 Ctrl+S 存到下载文件夹，` +
      `这里会自动收取（还会等 ${Math.max(1, Math.ceil(j.waitLeftMs / 60000))} 分钟）。`;
  } else if (j.status === "building") msg = "正在生成 PDF…";
  else if (j.status === "done") msg = j.message || "已导出";
  else {
    cls = "warn";
    msg = j.message || "导出失败";
  }
  const btns = [];
  if (j.status === "waiting") btns.push(`<button class="btn small" data-job="skip" data-id="${j.id}">不等了，先导出</button>`);
  if (j.status === "done" && j.output && WEB) {
    btns.push(
      j.openLabel
        ? `<a class="btn small primary" href="${esc(j.output)}" target="_blank" rel="noopener">${esc(j.openLabel)}</a>`
        : `<a class="btn small primary" href="${esc(j.output)}" download="${esc(j.filename ?? "")}">再次下载</a>`,
    );
  } else if (j.status === "done" && j.output) {
    btns.push(
      `<button class="btn small primary" data-job="open" data-path="${esc(j.output)}">${j.mode === "separate" ? "打开文件夹" : "打开 PDF"}</button>`,
      `<button class="btn small" data-job="reveal" data-path="${esc(j.output)}">在文件夹中显示</button>`,
    );
  }
  const icon = j.status === "done"
    ? `<span class="ok-ico">${I("check")}</span>`
    : j.status === "error"
    ? I("x")
    : '<span class="spinner"></span>';
  return `<div class="job"><div class="top">${icon}<b title="${esc(j.title)}">${esc(j.modeLabel)} · ${esc(j.title)}</b>` +
    (busy ? "" : `<button class="btn ghost small" data-job="dismiss" data-id="${j.id}" title="关闭">${I("x")}</button>`) +
    `</div>${busy && j.mode !== "digest" ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ""}` +
    `<div class="msg ${cls}">${esc(msg)}</div>${btns.length ? `<div class="btns">${btns.join("")}</div>` : ""}` +
    (j.links?.length
      ? `<div class="links">${j.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"><span>${esc(l.source)}</span>${esc(l.title)}</a>`).join("")}</div>`
      : "") + "</div>";
}

$("#jobs").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-job]");
  if (!b) return;
  try {
    if (b.dataset.job === "dismiss") {
      state.dismissed.add(b.dataset.id);
      renderJobs();
    } else if (b.dataset.job === "skip") await api(`/api/jobs/${b.dataset.id}/skip`, { method: "POST" });
    else await api("/api/open", { method: "POST", body: { kind: b.dataset.job === "reveal" ? "reveal" : "path", target: b.dataset.path } });
  } catch (e) {
    fail(e);
  }
});

// ---------------------------------------------------------------- paper cards

function authorsShort(a) {
  if (!a?.length) return "";
  return esc(a.length > 6 ? `${a.slice(0, 5).join(", ")} … ${a[a.length - 1]}（${a.length} 位作者）` : a.join(", "));
}
const scoreClass = (s) => (s >= 65 ? "high" : s >= 40 ? "mid" : "");

function card(p) {
  state.papers.set(p.uid, p);
  const sel = state.selection.has(p.uid);
  const topics = (p.topicIds ?? []).map((id) => state.topicNames.get(id)).filter(Boolean);
  const tags = topics.map((n) => `<span class="tag">${esc(n)}</span>`).join("") +
    (p.matched ?? []).slice(0, 6).map((k) => `<span class="tag kw">${esc(k)}</span>`).join("");
  const cls = ["paper", sel && "selected", p.isRec && !p.read && "unread", p.rating < 0 && "disliked"].filter(Boolean).join(" ");
  return `<article class="${cls}" data-uid="${esc(p.uid)}">
  <div class="pick"><input type="checkbox" data-act="select" ${sel ? "checked" : ""} title="选中后可批量导出 PDF"></div>
  <div>
    <div class="meta">
      <span class="src ${p.source}">${esc(srcName(p.source))}</span>
      <span title="${esc(p.updated)}">${fmtDate(p.updated)}</span>
      ${p.version > 1 ? `<span class="ver">v${p.version}</span>` : ""}
      ${p.categories.slice(0, 3).map((c) => `<span class="cat">${esc(c)}</span>`).join("")}
      ${p.score != null ? `<span class="score ${scoreClass(p.score)}" title="相关度（0–100）">${p.score}</span>` : ""}
    </div>
    <h3 class="title" lang="en"><a href="${esc(p.url)}" target="_blank" rel="noopener" data-act="read">${p.titleHtml}</a></h3>
    <div class="authors">${authorsShort(p.authors)}</div>
    ${tags ? `<div class="tags">${tags}</div>` : ""}
    <div class="abstract collapsed" lang="en" data-act="expand">${p.abstractHtml || "<p>（没有摘要）</p>"}</div>
    <div class="actions">
      <button class="btn ghost" data-act="toggle">${I("chev")}<span>展开摘要</span></button>
      <a class="btn ghost" href="${esc(p.pdfUrl)}" target="_blank" rel="noopener" data-act="read">${I("file")}PDF</a>
      ${p.hasPdf ? `<button class="btn ghost" data-act="local" title="用本机的 PDF 阅读器打开已下载的文件">${I("folder")}本地PDF</button>` : ""}
      <button class="btn ghost${p.starred ? " on" : ""}" data-act="star">${I("star")}${p.starred ? "已收藏" : "收藏"}</button>
      <span class="sep"></span>
      <button class="btn ghost${p.rating > 0 ? " on" : ""}" data-act="like" title="相关：以后多推荐类似的">${I("up")}相关</button>
      <button class="btn ghost${p.rating < 0 ? " on bad" : ""}" data-act="dislike" title="不相关：以后少推荐类似的">${I("down")}不相关</button>
    </div>
  </div>
</article>`;
}

function rerender(p) {
  const art = $(`.paper[data-uid="${CSS.escape(p.uid)}"]`);
  if (!art) return;
  const open = !$(".abstract", art).classList.contains("collapsed");
  art.outerHTML = card(p);
  if (open) setExpanded($(`.paper[data-uid="${CSS.escape(p.uid)}"]`), true);
}

function setExpanded(art, open) {
  $(".abstract", art).classList.toggle("collapsed", !open);
  $('[data-act="toggle"] span', art).textContent = open ? "收起摘要" : "展开摘要";
}

function markRead(p, art) {
  if (!p?.isRec || p.read) return;
  p.read = true;
  art?.classList.remove("unread");
  api("/api/mark", { method: "POST", body: { uid: p.uid, read: true } }).then(() => {
    if (state.app) state.app.unread = Math.max(0, state.app.unread - 1);
    renderSide();
  }).catch(() => {});
}

async function paperAction(act, el, art) {
  const p = state.papers.get(art.dataset.uid);
  if (!p) return;
  switch (act) {
    case "select":
      if (el.checked) state.selection.set(p.uid, p);
      else state.selection.delete(p.uid);
      art.classList.toggle("selected", el.checked);
      renderSelbar();
      return;
    case "expand":
      if (!$(".abstract", art).classList.contains("collapsed")) return;
      setExpanded(art, true);
      markRead(p, art);
      return;
    case "toggle": {
      const open = $(".abstract", art).classList.contains("collapsed");
      setExpanded(art, open);
      if (open) markRead(p, art);
      return;
    }
    case "read":
      markRead(p, art);
      return;
    case "local":
      await api("/api/open", { method: "POST", body: { kind: "pdf", target: p.uid } });
      return;
    case "star": {
      const r = await api("/api/mark", { method: "POST", body: { uid: p.uid, starred: !p.starred } });
      p.starred = r.mark.starred;
      rerender(p);
      toast(p.starred ? "已收藏" : "已取消收藏");
      return;
    }
    case "like":
    case "dislike": {
      const want = act === "like" ? 1 : -1;
      const rating = p.rating === want ? 0 : want;
      const r = await api("/api/mark", { method: "POST", body: { uid: p.uid, rating, read: true } });
      p.rating = r.mark.rating;
      if (p.isRec && !p.read) {
        p.read = true;
        if (state.app) state.app.unread = Math.max(0, state.app.unread - 1);
        renderSide();
      }
      rerender(p);
      if (rating > 0) toast("记下了：以后会多推荐类似的文章");
      if (rating < 0) toast("记下了：以后会少推荐类似的文章");
      return;
    }
  }
}

main.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const art = el.closest(".paper");
  try {
    if (art) await paperAction(act, el, art);
    else await state.handlers[act]?.(el, ev);
  } catch (e) {
    fail(e);
  }
});

main.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-change]");
  if (el) Promise.resolve(state.handlers[el.dataset.change]?.(el, ev)).catch(fail);
});

// drop a PDF on a card to attach it (e.g. a ChemRxiv PDF saved by hand)
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
main.addEventListener("dragover", (e) => {
  const art = e.target.closest(".paper");
  if (!WEB && art && e.dataTransfer?.types.includes("Files")) art.classList.add("drop");
});
main.addEventListener("dragleave", (e) => e.target.closest?.(".paper")?.classList.remove("drop"));
main.addEventListener("drop", async (e) => {
  const art = e.target.closest(".paper");
  if (!art || WEB) return;
  art.classList.remove("drop");
  const f = e.dataTransfer.files[0];
  if (!f || !/\.pdf$/i.test(f.name)) return toast("请拖入 PDF 文件", true);
  try {
    await api(`/api/pdf?uid=${encodeURIComponent(art.dataset.uid)}`, { method: "POST", body: f, raw: true });
    const p = state.papers.get(art.dataset.uid);
    p.hasPdf = true;
    rerender(p);
    toast("已关联这篇的 PDF，导出时会直接使用");
  } catch (err) {
    fail(err);
  }
});

// ---------------------------------------------------------------- selection & export

function renderSelbar() {
  const n = state.selection.size;
  const bar = $("#selbar");
  bar.hidden = !n;
  if (!n) return;
  bar.innerHTML = `<span>已选 <b>${n}</b> 篇</span>
    <button class="btn primary" data-exp="merged" title="目录 + 全文，带书签">${I("download")}导出为一个PDF</button>
    <button class="btn" data-exp="separate">逐篇PDF</button>
    <button class="btn" data-exp="digest">摘要清单</button>
    <button class="btn ghost" data-exp="clear" title="取消选择">${I("x")}</button>`;
}

function clearSelection() {
  state.selection.clear();
  $$(".paper.selected").forEach((a) => {
    a.classList.remove("selected");
    $('[data-act="select"]', a).checked = false;
  });
  renderSelbar();
}

function selectUids(uids) {
  for (const uid of uids) {
    const p = state.papers.get(uid);
    if (!p) continue;
    state.selection.set(uid, p);
    const art = $(`.paper[data-uid="${CSS.escape(uid)}"]`);
    if (art) {
      art.classList.add("selected");
      $('[data-act="select"]', art).checked = true;
    }
  }
  renderSelbar();
}

function selectionTitle() {
  if (state.route === "search" && state.search.q) return `搜索：${state.search.q}`.slice(0, 60);
  if (state.route === "saved") return "我的收藏";
  if (state.route === "feed") return "推荐精选";
  return "文献合集";
}

async function startExport(uids, mode, title) {
  if (!uids.length) return toast("请先选择文章", true);
  const job = await api("/api/export", { method: "POST", body: { uids, mode, title } });
  toast(`开始导出 ${job.total} 篇（${job.modeLabel}）`);
  poll();
}

$("#selbar").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-exp]");
  if (!b) return;
  if (b.dataset.exp === "clear") return clearSelection();
  startExport([...state.selection.keys()], b.dataset.exp, selectionTitle()).then(clearSelection).catch(fail);
});

// ---------------------------------------------------------------- menus & modal

function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  m.id = "popmenu";
  m.innerHTML = items.map((it, i) => `<button data-i="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`)
    .join("");
  m.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.stopPropagation();
    closeMenu();
    Promise.resolve(items[Number(b.dataset.i)].run()).catch(fail);
  });
  (anchor.closest(".menu-wrap") ?? anchor.parentElement).append(m);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}
const closeMenu = () => $("#popmenu")?.remove();

function closeModal() {
  modal.hidden = true;
  modal.innerHTML = "";
}
modal.addEventListener("mousedown", (e) => e.target === modal && closeModal());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenu();
    closeModal();
  }
});

// ---------------------------------------------------------------- feed

async function runNow() {
  const r = await api("/api/run?from=ui", { method: "POST" });
  if (!r.started) toast("已经在推荐中…");
  if (state.app) state.app.running = true;
  renderStrip();
  renderSide();
  poll();
}

function renderStrip() {
  const el = $("#strip");
  const a = state.app;
  if (!el || !a) return;
  if (!a.topics.length) {
    el.innerHTML = "";
    return;
  }
  if (a.running) {
    el.innerHTML = `<div class="banner"><span class="spinner"></span><div class="grow"><b>正在从各预印本平台获取新文章…</b>` +
      `<small>按你的兴趣主题筛选并打分，通常需要 10–60 秒</small></div></div>`;
    return;
  }
  const s = a.settings;
  const last = a.lastRun;
  const lastTxt = last
    ? `上次 ${fmtWhen(Date.parse(last.startedAt))}：${
      last.status === "error" ? `失败（${esc(last.error || "")}）` : `新增 ${last.nNew} 篇`
    }`
    : "还没有推荐过";
  const next = !s.scheduleEnabled
    ? `<span class="big">自动推荐已暂停</span>`
    : a.nextRunAt
    ? `<span class="big">下次自动推荐：${fmtWhen(a.nextRunAt)}</span> <span class="muted">（${fmtIn(a.nextRunAt)} · ${scheduleText(s)}）</span>`
    : `<span class="big">先启用一个兴趣主题</span>`;
  el.innerHTML = `<div class="strip">${I("bell")}<div class="grow">${next}<div class="muted">${lastTxt}${WEB ? " · 网页版只在本页开着时推荐，关掉后再打开会自动补上" : ""}</div></div>` +
    `<a class="btn small ghost" href="#/settings">${I("sliders")}修改频率</a></div>` +
    (last?.notes?.length && last.status !== "error"
      ? `<div class="notes">${last.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>`
      : "");
}

function renderTopicFilter() {
  const el = $("#topic-filter");
  const topics = state.app?.topics ?? [];
  if (!el || topics.length < 2) return el && (el.innerHTML = "");
  el.innerHTML = [[0, "全部主题"], ...topics.map((t) => [t.id, t.name])]
    .map(([id, name]) => `<span class="chip${state.feedTopic === id ? " on" : ""}" data-act="filter" data-id="${id}">${esc(name)}</span>`)
    .join("");
}

function batchHtml({ run, papers }) {
  state.batches.set(run.id, papers.map((p) => p.uid));
  const unread = papers.filter((p) => !p.read).length;
  return `<section class="batch"><div class="batch-head"><h2>${fmtWhen(Date.parse(run.startedAt))}</h2>` +
    `<span class="muted">${TRIGGER[run.trigger] ?? ""} · ${papers.length} 篇${unread ? ` · ${unread} 篇未读` : ""}</span>` +
    `<div class="tools"><button class="btn small ghost" data-act="batch-select" data-run="${run.id}">全选本批</button>` +
    `<div class="menu-wrap split"><button class="btn small" data-act="batch-export" data-run="${run.id}" title="目录 + 全文，带书签">` +
    `${I("download")}导出本批PDF</button><button class="btn small" data-act="batch-menu" data-run="${run.id}">${I("chev")}</button></div>` +
    `</div></div><div class="list">${papers.map(card).join("")}</div></section>`;
}

function onboarding() {
  return `<div class="empty"><img src="icon.svg" alt=""><h2>先告诉我你关注什么</h2>
    <p>选一个模板马上开始（之后可以改关键词），或者自己新建一个兴趣主题。</p></div>
    <div class="grid">${TEMPLATES.map((t, i) => tplCard(t, i)).join("")}</div>
    <div class="more"><button class="btn" data-act="new-topic">${I("plus")}自定义主题</button></div>`;
}

async function loadFeed(more) {
  const feed = $("#feed");
  if (!feed) return;
  if (!state.app.topics.length && !more) {
    feed.innerHTML = onboarding();
    $("#feed-more").innerHTML = "";
    return;
  }
  if (!more) state.feedOffset = 0;
  const data = await api(`/api/feed?offset=${state.feedOffset}&limit=6&topic=${state.feedTopic || ""}`);
  state.feedOffset += data.batches.length;
  const html = data.batches.map(batchHtml).join("");
  if (more) feed.insertAdjacentHTML("beforeend", html);
  else {
    feed.innerHTML = html ||
      `<div class="empty"><img src="icon.svg" alt=""><h2>还没有推荐</h2><p>点「立即推荐」马上抓取一次，或等待下次自动推荐。</p></div>`;
  }
  $("#feed-more").innerHTML = data.hasMore ? `<button class="btn" data-act="feed-more">加载更早的推荐</button>` : "";
}

const batchTitle = (runId) => {
  const head = $(`[data-act="batch-export"][data-run="${runId}"]`)?.closest(".batch")?.querySelector("h2")?.textContent;
  return `推荐 ${head ?? ""}`.trim();
};

async function renderFeed() {
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>推荐</h1>
    <div class="sub">按你的兴趣主题，从 arXiv、ChemRxiv、bioRxiv 等 12 个预印本平台自动挑选的新文章</div></div>
    <div class="tools"><button class="btn" data-act="read-all">${I("checks")}全部标为已读</button>
    <button class="btn primary" data-act="run-now">${I("refresh")}立即推荐</button></div></div>
    <div id="strip"></div><div id="topic-filter" class="chips"></div><div id="feed"></div><div class="more" id="feed-more"></div></div>`;
  state.handlers = {
    "run-now": runNow,
    "read-all": async () => {
      await api("/api/feed/read", { method: "POST", body: {} });
      state.app.unread = 0;
      renderSide();
      await loadFeed(false);
    },
    "feed-more": () => loadFeed(true),
    filter: (el) => {
      state.feedTopic = Number(el.dataset.id);
      renderTopicFilter();
      return loadFeed(false);
    },
    "batch-select": (el) => selectUids(state.batches.get(Number(el.dataset.run)) ?? []),
    "batch-export": (el) => startExport(state.batches.get(Number(el.dataset.run)) ?? [], "merged", batchTitle(el.dataset.run)),
    "batch-menu": (el) => {
      const run = Number(el.dataset.run);
      const uids = state.batches.get(run) ?? [];
      openMenu(el, [
        { label: "逐篇 PDF", sub: "每篇一个文件，放在同一个文件夹", run: () => startExport(uids, "separate", batchTitle(run)) },
        { label: "摘要清单 PDF", sub: "标题、作者、链接和摘要，不含全文", run: () => startExport(uids, "digest", batchTitle(run)) },
        {
          label: "本批全部标为已读",
          run: async () => {
            await api("/api/feed/read", { method: "POST", body: { runId: run } });
            await loadFeed(false);
            poll();
          },
        },
      ]);
    },
    "use-template": (el) => addTemplate(Number(el.dataset.i)),
    "new-topic": () => openTopicEditor(),
  };
  renderStrip();
  renderTopicFilter();
  await loadFeed(false);
}

// ---------------------------------------------------------------- search

function renderSearch() {
  const s = state.search;
  const known = new Set(sources().map((x) => x.id));
  s.sources = (s.sources ?? rememberedSearchSources() ?? defaultSources()).filter((x) => known.has(x));
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === v ? "selected" : ""}>${label}</option>`;
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>搜索</h1>
    <div class="sub">实时检索 arXiv、ChemRxiv、bioRxiv 等 12 个预印本平台；勾选结果即可一键导出 PDF</div></div></div>
    <form class="searchbar" id="sform" autocomplete="off">
      <div class="row"><input type="text" id="sq" placeholder='例如："C-H activation" photoredox -review' value="${esc(s.q)}">
        <button class="btn primary" type="submit">${I("search")}搜索</button></div>
      <div class="row srcrow"><span class="lbl">来源</span>${sourceChips("ssrc", s.sources)}</div>
      <div class="row opts">
        <span>时间 <select id="sdays">${
    [["7", "最近 7 天"], ["30", "最近 30 天"], ["90", "最近 3 个月"], ["365", "最近 1 年"], ["0", "不限"]]
      .map(([v, l]) => opt(v, l, s.days)).join("")
  }</select></span>
        <span>范围 <select id="sfield">${opt("all", "标题 + 摘要", s.field)}${opt("ti", "仅标题", s.field)}${opt("au", "作者", s.field)}</select></span>
        <span>排序 <select id="ssort">${opt("date", "最新优先", s.sort)}${opt("relevance", "相关度优先", s.sort)}</select></span>
        <button type="button" class="btn ghost small" data-act="syntax">${I("help")}语法</button>
      </div>
      <div class="help" id="syntax" hidden><table>
        <tr><td><code>machine learning</code></td><td>空格 = 且：两个词都要出现</td></tr>
        <tr><td><code>"C-H activation"</code></td><td>引号 = 完整短语（C–H、C-H 写法都能匹配）</td></tr>
        <tr><td><code>photoredox, electrosynthesis</code></td><td>逗号 / <code>OR</code> / 换行 = 或</td></tr>
        <tr><td><code>catal*</code></td><td>星号 = 前缀（catalyst、catalysis、catalytic…）</td></tr>
        <tr><td><code>-review</code></td><td>减号或 <code>NOT</code> = 排除</td></tr>
        <tr><td><code>ti:perovskite</code> <code>au:Kulik</code></td><td>只在标题 / 作者里找</td></tr>
        <tr><td><code>(MOF, COF) "water harvesting"</code></td><td>括号组合条件</td></tr>
      </table></div>
    </form>
    <div id="sresults"></div><div class="more" id="smore"></div></div>`;
  $("#ssrc").addEventListener("click", chipClick);
  $("#sform").addEventListener("submit", (e) => {
    e.preventDefault();
    s.q = $("#sq").value.trim();
    s.sources = chosenSources("ssrc");
    rememberSearchSources(s.sources);
    s.days = $("#sdays").value;
    s.field = $("#sfield").value;
    s.sort = $("#ssort").value;
    if (!s.q) return toast("请输入关键词", true);
    if (!s.sources.length) return toast("至少选择一个来源", true);
    doSearch(0);
  });
  state.handlers = {
    syntax: () => ($("#syntax").hidden = !$("#syntax").hidden),
    "search-more": () => doSearch(s.page + 1),
    "select-results": () => selectUids(s.results.map((p) => p.uid)),
    "save-as-topic": () =>
      openTopicEditor(null, { name: s.q.slice(0, 30), query: s.q, sources: s.sources, arxivCats: [], enabled: true }),
  };
  if (s.results.length || s.interpreted) renderResults();
  $("#sq").focus();
}

async function doSearch(page) {
  const s = state.search;
  if (page === 0) {
    $("#sresults").innerHTML = `<div class="banner"><span class="spinner"></span><div class="grow">正在检索 ${
      s.sources.length > 3 ? `${s.sources.length} 个预印本平台` : s.sources.map(srcName).join("、")
    }…</div></div>`;
    $("#smore").innerHTML = "";
  } else $("#smore").innerHTML = '<span class="spinner"></span>';
  const params = new URLSearchParams({ q: s.q, sources: s.sources.join(","), days: s.days, field: s.field, sort: s.sort, page });
  try {
    const r = await api(`/api/search?${params}`);
    s.page = page;
    s.hasMore = r.hasMore;
    s.interpreted = r.interpreted;
    s.notes = r.notes;
    const seen = new Set(page ? s.results.map((p) => p.uid) : []);
    s.results = [...(page ? s.results : []), ...r.papers.filter((p) => !seen.has(p.uid))];
    if (state.route === "search") renderResults();
  } catch (e) {
    if (state.route === "search") {
      $("#sresults").innerHTML = `<div class="notes">${esc(e.message)}</div>`;
      $("#smore").innerHTML = "";
    }
  }
}

function renderResults() {
  const s = state.search;
  $("#sresults").innerHTML = (s.notes?.length ? `<div class="notes">${s.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "") +
    (s.interpreted
      ? `<div class="interp">解析为：<b>${esc(s.interpreted)}</b> · 已加载 ${s.results.length} 篇
        <button class="btn small ghost" data-act="select-results">全选结果</button>
        <button class="btn small ghost" data-act="save-as-topic">${I("plus")}保存为兴趣主题</button></div>`
      : "") +
    (s.results.length
      ? `<div class="list">${s.results.map(card).join("")}</div>`
      : `<div class="empty"><h2>没有找到匹配的文章</h2><p>试试放宽时间范围，或减少关键词。</p></div>`);
  $("#smore").innerHTML = s.hasMore ? `<button class="btn" data-act="search-more">加载更多</button>` : "";
}

// ---------------------------------------------------------------- topics

function tplCard(t, i) {
  return `<button class="card tpl" data-act="use-template" data-i="${i}"><h3>${I("plus")}${esc(t.name)}</h3>` +
    `<div class="q">${esc(t.query)}</div><div class="chips">${t.sources.map(srcBadge).join("")}` +
    `${t.arxivCats.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div></button>`;
}
const srcBadge = (s) => `<span class="src ${s}">${esc(srcName(s))}</span>`;
/** Templates not added yet, with their index in TEMPLATES */
const templatesLeft = (topics) =>
  TEMPLATES.map((t, i) => [t, i]).filter(([t]) => !topics.some((x) => x.name === t.name));

async function addTemplate(i) {
  const t = TEMPLATES[i];
  await api("/api/topics", { method: "POST", body: { ...t, enabled: true } });
  toast(`已添加主题「${t.name}」，几秒后开始推荐…`);
  await poll();
  if (state.route === "topics") renderTopics();
  else if (state.route === "feed") loadFeed(false);
}

function topicCard(t) {
  return `<div class="card${t.enabled ? "" : " off"}">
    <h3>${esc(t.name)}<label class="switch" title="${t.enabled ? "已启用" : "已停用"}">
      <input type="checkbox" data-change="topic-enable" data-id="${t.id}" ${t.enabled ? "checked" : ""}><span></span></label></h3>
    <div class="q">${esc(t.query || "（不限关键词）")}</div>
    ${t.error ? `<div class="err">⚠ ${esc(t.error)}</div>` : `<div class="muted">解析为：${esc(t.interpreted)}</div>`}
    <div class="chips">${t.sources.map(srcBadge).join("")}${t.arxivCats.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>
    <div class="foot"><button class="btn small" data-act="edit-topic" data-id="${t.id}">${I("edit")}编辑</button>
      <button class="btn small" data-act="preview-topic" data-id="${t.id}">${I("eye")}预览近 7 天</button>
      <span style="flex:1"></span>
      <button class="btn small ghost" data-act="del-topic" data-id="${t.id}" title="删除">${I("trash")}</button></div></div>`;
}

let topicsCache = [];
async function renderTopics() {
  topicsCache = await api("/api/topics");
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>兴趣主题</h1>
    <div class="sub">自动推荐按这些主题筛选新文章；在文章上点「相关 / 不相关」，排序会越来越贴合你</div></div>
    <div class="tools"><button class="btn primary" data-act="new-topic">${I("plus")}新建主题</button></div></div>
    ${topicsCache.length ? `<div class="grid">${topicsCache.map(topicCard).join("")}</div>` : ""}
    ${templatesLeft(topicsCache).length ? `<div class="templates"><h2>${topicsCache.length ? "从模板添加" : "从一个模板开始"}</h2>
    <p>点一下就会添加，之后可以随时修改关键词和分类。</p>
    <div class="grid">${templatesLeft(topicsCache).map(([t, i]) => tplCard(t, i)).join("")}</div></div>` : ""}</div>`;
  const byId = (el) => topicsCache.find((t) => t.id === Number(el.dataset.id));
  state.handlers = {
    "new-topic": () => openTopicEditor(),
    "use-template": (el) => addTemplate(Number(el.dataset.i)),
    "edit-topic": (el) => openTopicEditor(byId(el)),
    "preview-topic": (el) => openTopicEditor(byId(el), null, true),
    "del-topic": async (el) => {
      const t = byId(el);
      if (!confirm(`删除主题「${t.name}」？已推荐的文章会保留。`)) return;
      await api(`/api/topics/${t.id}`, { method: "DELETE" });
      toast("已删除");
      poll();
      renderTopics();
    },
    "topic-enable": async (el) => {
      const t = byId(el);
      await api(`/api/topics/${t.id}`, { method: "PUT", body: { ...t, enabled: el.checked } });
      toast(el.checked ? `已启用「${t.name}」` : `已停用「${t.name}」`);
      poll();
      renderTopics();
    },
  };
}

function openTopicEditor(t = null, preset = null, previewNow = false) {
  const v = t ?? preset ?? { name: "", query: "", sources: defaultSources(), arxivCats: [], enabled: true };
  const known = new Set(ARXIV_CATS.map(([c]) => c));
  modal.innerHTML = `<div class="dialog"><header><h2>${t ? "编辑主题" : "新建兴趣主题"}</h2>
    <button class="btn ghost x" data-m="close">${I("x")}</button></header>
    <div class="body">
      <div class="form-row"><label for="tn">名称</label><input type="text" id="tn" value="${esc(v.name)}" placeholder="例如：AI × 化学"></div>
      <div class="form-row"><label for="tq">关键词（英文）</label>
        <textarea id="tq" rows="4" placeholder='逗号或换行分隔 = 或；空格 = 且；"引号" = 短语；* = 前缀；-词 = 排除'>${esc(v.query)}</textarea>
        <small id="tq-check">例：<code>"C-H activation", photoredox</code> 或 <code>("machine learning", "deep learning") catalys*</code></small></div>
      <div class="form-row"><label>来源 <small>（点选；arXiv 还可以按下面的分类订阅）</small></label>${sourceChips("tsrc", v.sources)}</div>
      <div class="form-row"><label>arXiv 分类 <small>（可选；不选 = 在全部分类里按关键词找）</small></label>
        <div class="chips" id="tcats">${
    ARXIV_CATS.map(([c, n]) => `<span class="chip${v.arxivCats.includes(c) ? " on" : ""}" data-cat="${c}" title="${c}">${n}</span>`).join("")
  }</div>
        <input type="text" id="tcat-extra" placeholder="其他分类代码，逗号分隔，如 cond-mat.supr-con" value="${
    esc(v.arxivCats.filter((c) => !known.has(c)).join(", "))
  }"></div>
      <div id="tpreview"></div>
    </div>
    <footer><span class="left">「预览」会用最近 7 天的新文章试一试，不会保存</span>
      <button class="btn" data-m="preview">${I("eye")}预览</button><button class="btn primary" data-m="save">保存</button></footer></div>`;
  modal.hidden = false;

  const collect = () => ({
    name: $("#tn").value.trim(),
    query: $("#tq").value,
    sources: chosenSources("tsrc"),
    arxivCats: [
      ...$$("#tcats .chip.on").map((c) => c.dataset.cat),
      ...$("#tcat-extra").value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean),
    ],
    enabled: v.enabled !== false,
  });

  let timer = 0;
  const check = async () => {
    const q = $("#tq").value;
    if (!q.trim()) {
      $("#tq-check").innerHTML = "关键词为空时，只按 arXiv 分类订阅（ChemRxiv 需要关键词）";
      return;
    }
    const r = await api("/api/query/check", { method: "POST", body: { query: q } });
    $("#tq-check").className = r.ok ? "ok" : "bad";
    $("#tq-check").textContent = r.ok ? `解析为：${r.interpreted}` : `⚠ ${r.error}`;
  };
  $("#tq").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => check().catch(() => {}), 300);
  });
  if (v.query) check().catch(() => {});

  const preview = async () => {
    const box = $("#tpreview");
    box.innerHTML = '<div class="banner"><span class="spinner"></span><div class="grow">正在用最近 7 天的新文章预览…</div></div>';
    try {
      const r = await api("/api/topics/preview", { method: "POST", body: { ...collect(), name: collect().name || "预览", days: 7 } });
      box.innerHTML = (r.notes.length ? `<div class="notes">${r.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "") +
        `<div class="form-row"><label>最近 7 天匹配 ${r.total} 篇${r.total > r.papers.length ? `（显示前 ${r.papers.length} 篇）` : ""}</label>` +
        (r.papers.length
          ? `<div class="preview">${
            r.papers.map((p) =>
              `<div class="item"><span class="score ${scoreClass(p.score)}">${p.score}</span><span class="t">${p.titleHtml}</span>` +
              `<span class="src ${p.source}">${esc(srcName(p.source))}</span></div>`
            ).join("")
          }</div>`
          : "<small>没有匹配的文章。可以放宽关键词，或者加上 * 前缀匹配。</small>") + "</div>";
    } catch (e) {
      box.innerHTML = `<div class="notes">${esc(e.message)}</div>`;
    }
  };

  modal.onclick = async (e) => {
    if (chipClick(e)) return;
    const chip = e.target.closest("[data-cat]");
    if (chip) return chip.classList.toggle("on");
    const b = e.target.closest("[data-m]");
    if (!b) return;
    if (b.dataset.m === "close") return closeModal();
    if (b.dataset.m === "preview") return preview();
    try {
      const body = collect();
      if (t) await api(`/api/topics/${t.id}`, { method: "PUT", body });
      else await api("/api/topics", { method: "POST", body });
      closeModal();
      toast(t ? "已保存" : "已保存，几秒后按新主题推荐…");
      await poll();
      if (state.route === "topics") renderTopics();
      if (state.route === "feed") loadFeed(false);
    } catch (err) {
      fail(err);
    }
  };
  if (previewNow) preview();
  else $("#tn").focus();
}

// ---------------------------------------------------------------- saved

async function renderSaved() {
  const { papers } = await api("/api/saved");
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>收藏</h1>
    <div class="sub">在任意文章上点「收藏」，就会出现在这里</div></div>
    ${papers.length ? `<div class="tools"><button class="btn" data-act="select-all">全选</button></div>` : ""}</div>
    ${
    papers.length
      ? `<div class="list">${papers.map(card).join("")}</div>`
      : `<div class="empty"><img src="icon.svg" alt=""><h2>还没有收藏</h2><p>在推荐或搜索结果里点「收藏」。</p></div>`
  }</div>`;
  state.handlers = { "select-all": () => selectUids(papers.map((p) => p.uid)) };
}

// ---------------------------------------------------------------- exports

async function renderExports() {
  const rows = await api("/api/exports");
  const dir = state.app.settings.exportDir;
  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>导出记录</h1>
    <div class="sub">PDF 保存在 <span class="path">${esc(dir)}</span></div></div>
    <div class="tools"><button class="btn" data-act="open-dir">${I("folder")}打开导出文件夹</button></div></div>
    <div class="rows">${
    rows.map((r) =>
      `<div class="rowitem">${I(r.mode === "separate" ? "folder" : "file")}<div class="grow"><b>${esc(r.title)}</b>
        <span class="pill">${MODE[r.mode] ?? r.mode}</span>
        ${r.nMissing ? `<span class="pill warn">${r.nMissing} 篇未含 PDF</span>` : ""}
        ${r.exists ? "" : '<span class="pill gone">文件已移动或删除</span>'}
        <span class="path" title="${esc(r.path)}">${esc(r.path)}</span>
        <small style="color:var(--muted)">${fmtWhen(Date.parse(r.createdAt))} · ${r.n} 篇</small></div>
        ${
        r.exists
          ? `<button class="btn small" data-act="open" data-path="${esc(r.path)}">打开</button>
             <button class="btn small ghost" data-act="reveal" data-path="${esc(r.path)}">在文件夹中显示</button>`
          : ""
      }</div>`
    ).join("") ||
    `<div class="empty"><img src="icon.svg" alt=""><h2>还没有导出过</h2><p>勾选文章，在底部点「导出为一个PDF」。</p></div>`
  }</div></div>`;
  state.handlers = {
    "open-dir": () => api("/api/open", { method: "POST", body: { kind: "path", target: dir } }),
    open: (el) => api("/api/open", { method: "POST", body: { kind: "path", target: el.dataset.path } }),
    reveal: (el) => api("/api/open", { method: "POST", body: { kind: "reveal", target: el.dataset.path } }),
  };
}

// ---------------------------------------------------------------- settings

function renderNext() {
  const el = $("#s-next");
  const a = state.app;
  if (!el || !a) return;
  el.textContent = a.running
    ? "正在推荐…"
    : !a.settings.scheduleEnabled
    ? "自动推荐已暂停"
    : a.nextRunAt
    ? `${fmtWhen(a.nextRunAt)}（${fmtIn(a.nextRunAt)}）`
    : "添加并启用兴趣主题后开始";
}

function renderSettings() {
  const a = state.app;
  const s = a.settings;
  const sel = (id, opts, cur) =>
    `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const sw = (id, on, extra = "") => `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""} ${extra}><span></span></label>`;
  const field = (title, help, ctl) =>
    `<div class="field"><div><b>${title}</b>${help ? `<small>${help}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`;
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;

  const desktopOnly = WEB ? "" : `
  <div class="section"><h2>PDF 导出</h2>
    ${
    field(
      "导出文件夹",
      "",
      `<input type="text" id="s-export" class="path" value="${esc(s.exportDir)}"><button class="btn small" data-act="pick" data-target="s-export">选择…</button>
       <button class="btn small ghost" data-act="open-dir">打开</button>`,
    )
  }
    ${
    field(
      "推荐后自动导出",
      "每次自动推荐出新文章后，自动生成 PDF 放进导出文件夹",
      sel("s-auto", [["off", "不自动导出"], ["merged", "合并为一个PDF（含目录）"], ["separate", "逐篇PDF（文件夹）"], ["digest", "摘要清单PDF"]], s.autoExport),
    )
  }
    ${
    field(
      "需浏览器下载的 PDF",
      "ChemRxiv、SSRN、ESS Open Archive、Authorea、engrXiv 只允许浏览器下载 PDF。导出时程序会在浏览器里打开它们，你保存到下载文件夹后会被自动收取；也可以把 PDF 直接拖到文章卡片上",
      `<label class="check"><input type="checkbox" id="s-openbrowser" ${s.openBrowserForBlocked ? "checked" : ""}>导出时自动在浏览器中打开</label>`,
    )
  }
    ${
    field(
      "浏览器下载文件夹",
      "",
      `<input type="text" id="s-dl" class="path" value="${esc(s.downloadsDir)}"><button class="btn small" data-act="pick" data-target="s-dl">选择…</button>`,
    )
  }
  </div>
  <div class="section"><h2>通知与启动</h2>
    ${field("桌面通知", "自动推荐出新文章时弹出 Windows 通知", `${sw("s-notify", s.notify)}<button class="btn small" data-act="notify-test">${I("bell")}发送测试通知</button>`)}
    ${
    field(
      "开机自动启动",
      a.compiled ? "登录 Windows 后在托盘里后台运行，按时推荐" : "需要用打包好的 PreprintRadar.exe 运行",
      sw("s-autostart", s.autostart, a.compiled ? "" : "disabled"),
    )
  }
    ${
    field(
      "主窗口",
      "关闭窗口后程序仍在托盘里继续运行；托盘菜单里可以退出",
      sel("s-browser", [["edge", "Edge 应用窗口"], ["chrome", "Chrome 应用窗口"], ["default", "默认浏览器标签页"]], s.uiBrowser),
    )
  }
  </div>
  <div class="section"><h2>关于</h2>
    ${field("版本", "", `预印本雷达 v${esc(a.version)} · ${link(a.links.web, "网页版")} · ${link(a.links.repo, "GitHub")}`)}
    ${field("数据文件夹", "数据库、PDF 缓存和日志", `<span class="path">${esc(a.dataDir)}</span><button class="btn small ghost" data-act="open-data">打开</button>`)}
  </div>`;

  const webOnly = !WEB ? "" : `
  <div class="section"><h2>通知</h2>
    ${
    field(
      "浏览器通知",
      a.notificationPermission === "denied" ? "浏览器已禁止本站通知，请在地址栏左侧的网站设置里允许" : "本页开着时（可以最小化），自动推荐出新文章会弹出通知",
      `${sw("s-notify", s.notify)}<button class="btn small" data-act="notify-test">${I("bell")}测试通知</button>`,
    )
  }
  </div>
  <div class="section"><h2>关于网页版</h2>
    ${field("数据", "主题、推荐和收藏只保存在你这台电脑的浏览器里（localStorage），不会上传；换浏览器或清除网站数据后会丢失", "")}
    ${
    field(
      "网页版的限制",
      "只在本页开着时定时推荐；导出时只有 arXiv 的全文能直接打包进 PDF，其他平台给出链接",
      `${link(a.links.download, "下载 Windows 桌面版")}（后台定时推荐 · 所有平台的 PDF 自动下载 · 系统通知）`,
    )
  }
    ${field("版本", "", `预印本雷达 v${esc(a.version)} · ${link(a.links.repo, "GitHub 源代码")}`)}
  </div>`;

  main.innerHTML = `<div class="page"><div class="page-head"><div><h1>设置</h1><div class="sub">改完点底部的「保存设置」</div></div></div>
  <div class="section"><h2>自动推荐</h2>
    ${
    field(
      "自动推荐",
      WEB ? "本页开着时按下面的频率自动抓取、筛选；关掉页面后，下次打开会自动补上错过的推荐" : "程序开着（包括只在托盘里）时，按下面的频率自动抓取、筛选并通知你",
      sw("s-enabled", s.scheduleEnabled),
    )
  }
    ${
    field(
      "频率",
      "arXiv 每个工作日晚上（北美东部时间）更新一次；其他平台全天陆续发布",
      `<label class="check"><input type="radio" name="s-mode" value="interval" ${s.scheduleMode === "interval" ? "checked" : ""}>每隔</label>
       <input type="number" id="s-every" min="1" max="999" value="${s.intervalValue}">
       ${sel("s-unit", [["minutes", "分钟"], ["hours", "小时"], ["days", "天"]], s.intervalUnit)}
       <span style="width:18px"></span>
       <label class="check"><input type="radio" name="s-mode" value="daily" ${s.scheduleMode === "daily" ? "checked" : ""}>每天</label>
       <input type="time" id="s-daily" value="${s.dailyTime}">`,
    )
  }
    ${field("下次推荐", "", `<span id="s-next"></span><button class="btn small" data-act="run-now">${I("refresh")}立即推荐一次</button>`)}
  </div>
  <div class="section"><h2>推荐内容</h2>
    ${field("每次最多推荐", "", `<input type="number" id="s-max" min="1" max="200" value="${s.maxPerRun}"> 篇`)}
    ${field("回看天数", "每次检查最近几天发布的文章；推荐过的不会重复出现", `<input type="number" id="s-look" min="1" max="30" value="${s.lookbackDays}"> 天`)}
    ${field("相关度门槛", "0–100；低于这个分数的文章不推荐", `<input type="number" id="s-min" min="0" max="100" value="${s.minScore}">`)}
  </div>${desktopOnly}${webOnly}
  <div class="savebar"><button class="btn primary" data-act="save">保存设置</button></div></div>`;
  renderNext();
  state.handlers = {
    "run-now": runNow,
    "open-dir": () => api("/api/open", { method: "POST", body: { kind: "path", target: $("#s-export").value } }),
    "open-data": () => api("/api/open", { method: "POST", body: { kind: "path", target: a.dataDir } }),
    pick: async (el) => {
      const input = $("#" + el.dataset.target);
      toast("请在弹出的窗口中选择文件夹");
      const r = await api("/api/pick-folder", { method: "POST", body: { initial: input.value, title: "选择文件夹" } });
      if (r.path) input.value = r.path;
    },
    "notify-test": async () => {
      const r = await api("/api/notify-test", { method: "POST" });
      if (WEB) toast(r.ok ? "已发送测试通知" : "浏览器没有允许通知", !r.ok);
      else toast(r.ok ? "已发送测试通知，看看屏幕右下角" : "通知发送失败，请检查 Windows 的通知设置", !r.ok);
    },
    save: async () => {
      const body = {
        scheduleEnabled: $("#s-enabled").checked,
        scheduleMode: $('input[name="s-mode"]:checked').value,
        intervalValue: Number($("#s-every").value),
        intervalUnit: $("#s-unit").value,
        dailyTime: $("#s-daily").value,
        maxPerRun: Number($("#s-max").value),
        lookbackDays: Number($("#s-look").value),
        minScore: Number($("#s-min").value),
        notify: $("#s-notify").checked,
      };
      if (!WEB) {
        Object.assign(body, {
          exportDir: $("#s-export").value,
          downloadsDir: $("#s-dl").value,
          autoExport: $("#s-auto").value,
          openBrowserForBlocked: $("#s-openbrowser").checked,
          autostart: $("#s-autostart").checked,
          uiBrowser: $("#s-browser").value,
        });
      }
      const r = await api("/api/settings", { method: "PUT", body });
      state.app = r;
      renderSide();
      if (r.warning) toast(r.warning, true);
      else toast("设置已保存");
      renderSettings();
    },
  };
}

// ---------------------------------------------------------------- router

const ROUTES = {
  feed: renderFeed,
  search: renderSearch,
  topics: renderTopics,
  saved: renderSaved,
  exports: renderExports,
  settings: renderSettings,
};

function go() {
  const r = (location.hash.match(/^#\/(\w+)/) ?? [])[1];
  state.route = ROUTES[r] ? r : "feed";
  closeMenu();
  closeModal();
  state.handlers = {};
  renderSide();
  main.scrollTop = 0;
  Promise.resolve(ROUTES[state.route]()).catch(fail);
}

window.addEventListener("hashchange", go);
await poll();
go();
