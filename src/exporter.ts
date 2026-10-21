/**
 * "One-click PDF export". Three outputs:
 *   merged   — one PDF: generated table of contents + every paper, with bookmarks
 *   separate — a folder: one PDF per paper + "00 目录与摘要.pdf"
 *   digest   — one PDF of titles, links and abstracts (no full texts)
 * arXiv PDFs are downloaded directly. ChemRxiv only serves PDFs to real browsers, so those are opened
 * in the user's browser and picked up from the Downloads folder once saved.
 */
import { PDFDocument } from "pdf-lib";
import { addOutline, textContents, textPlaceholder } from "./pdftext.ts";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, PDF_CACHE, type Settings, TMP_DIR, VERSION } from "./config.ts";
import * as db from "./db.ts";
import { politeFetch } from "./http.ts";
import { log } from "./log.ts";
import { errMsg } from "./recommend.ts";
import { sourceInfo } from "./sources/registry.ts";
import { htmlToPdf, openUrl } from "./system.ts";
import { coverHtml, digestHtml, type Entry, placeholderHtml } from "./templates.ts";
import { plainTitle, safeFilename, stampLocal, surname } from "./text.ts";
import type { ExportMode, Paper, Source } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ItemState = "pending" | "ready" | "browser" | "failed";

export interface JobItem {
  uid: string;
  title: string;
  source: string;
  state: ItemState;
  note?: string;
  file?: string;
}

export interface Job {
  id: string;
  mode: ExportMode;
  title: string;
  status: "running" | "waiting" | "building" | "done" | "error";
  items: JobItem[];
  createdAt: string;
  finishedAt?: string;
  output?: string;
  message?: string;
  skipWait: boolean;
  waitUntil?: number;
  auto: boolean;
}

export const MODE_LABEL: Record<ExportMode, string> = { merged: "合并为一个PDF", separate: "逐篇PDF", digest: "摘要清单PDF" };

const jobs = new Map<string, Job>();

export const getJob = (id: string) => jobs.get(id) ?? null;

export function recentJobs(): Job[] {
  for (const [id, j] of jobs) {
    if (j.finishedAt && Date.now() - Date.parse(j.finishedAt) > 3_600_000) jobs.delete(id);
  }
  return [...jobs.values()].reverse();
}

export function skipWait(id: string) {
  const j = jobs.get(id);
  if (j) j.skipWait = true;
}

export function startExport(uids: string[], mode: ExportMode, title?: string, auto = false): Job {
  const papers = db.getPapers(uids);
  if (!papers.length) throw new Error("没有找到要导出的文章");
  const job: Job = {
    id: crypto.randomUUID().slice(0, 8),
    mode,
    title: title?.trim() || `文献合集（${papers.length}篇）`,
    status: "running",
    items: papers.map((p) => ({ uid: p.uid, title: plainTitle(p.title), source: p.source, state: "pending" })),
    createdAt: new Date().toISOString(),
    skipWait: false,
    auto,
  };
  jobs.set(job.id, job);
  runJob(job, papers).catch((e) => {
    job.status = "error";
    job.message = errMsg(e);
    job.finishedAt = new Date().toISOString();
    log(`export ${job.id} failed`, e);
  });
  return job;
}

// ---------------------------------------------------------------- PDF cache and acquisition

const cacheFile = (p: Paper) => join(PDF_CACHE, `${p.source}_${p.extId.replace(/[^\w.-]+/g, "_")}_v${p.version}.pdf`);

/** "%PDF-" within the first KB (the spec allows leading junk). */
function hasPdfHeader(b: Uint8Array): boolean {
  const n = Math.min(b.length - 5, 1024);
  for (let i = 0; i < n; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
}

export function isPdfFile(path: string): boolean {
  try {
    const f = Deno.openSync(path);
    const buf = new Uint8Array(1029);
    const n = f.readSync(buf) ?? 0;
    f.close();
    return hasPdfHeader(buf.subarray(0, n));
  } catch {
    return false;
  }
}

export function cachedPdf(p: Paper): string | null {
  const f = cacheFile(p);
  return isPdfFile(f) ? f : null;
}

export function storePdf(p: Paper, bytes: Uint8Array): string {
  if (!hasPdfHeader(bytes)) throw new Error("这不是有效的 PDF 文件");
  Deno.mkdirSync(PDF_CACHE, { recursive: true });
  const f = cacheFile(p);
  Deno.writeFileSync(f, bytes);
  return f;
}

const slugKey = (s: string) => plainTitle(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Sites name downloads after their id: chemrxiv.15010774_v1.pdf, ssrn-7629359.pdf, preprints202610.1718.v1.pdf */
const DOWNLOAD_PREFIX: Partial<Record<Source, string>> = {
  chemrxiv: "chemrxiv",
  ssrn: "ssrn",
  essoar: "essoar",
  authorea: "authorea",
  preprints: "preprints",
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A PDF the user saved from the browser, recognised by the site's file name for it or by the title. */
export function findInDownloads(p: Paper, dir: string): string | null {
  if (!dir) return null;
  const id = escRe(p.extId.toLowerCase());
  const prefix = DOWNLOAD_PREFIX[p.source];
  const idRe = prefix
    ? new RegExp(`${prefix}[^a-z0-9]*${id}(?![a-z0-9])`)
    : p.extId.length >= 6
    ? new RegExp(`(?<![a-z0-9])${id}(?![0-9])`)
    : /(?!)/;
  const titleKey = slugKey(p.title).slice(0, 40);
  let best: { path: string; mtime: number } | null = null;
  try {
    for (const e of Deno.readDirSync(dir)) {
      if (!e.isFile || !/\.pdf$/i.test(e.name)) continue;
      const byId = idRe.test(e.name.toLowerCase());
      const byTitle = titleKey.length >= 20 && slugKey(e.name).includes(titleKey);
      if (!byId && !byTitle) continue;
      const full = join(dir, e.name);
      const mtime = Deno.statSync(full).mtime?.getTime() ?? 0;
      if (!best || mtime > best.mtime) best = { path: full, mtime };
    }
  } catch { /* folder missing */ }
  return best && isPdfFile(best.path) ? best.path : null;
}

function adopt(p: Paper, from: string, it: JobItem) {
  it.file = storePdf(p, Deno.readFileSync(from));
  it.state = "ready";
  it.note = "已从下载文件夹导入";
}

async function acquire(p: Paper, it: JobItem, downloadsDir: string) {
  const cached = cachedPdf(p);
  if (cached) {
    it.state = "ready";
    it.file = cached;
    return;
  }
  const saved = findInDownloads(p, downloadsDir);
  if (saved) return adopt(p, saved, it);
  // ChemRxiv, SSRN, ESSOAr… answer programs with a Cloudflare challenge: don't knock, hand it to the browser
  if (sourceInfo(p.source).pdf === "browser") {
    it.state = "browser";
    it.note = "需在浏览器中下载";
    return;
  }
  try {
    const res = await politeFetch(p.pdfUrl, { timeoutMs: 180_000, retries: 2, accept: "application/pdf" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok && hasPdfHeader(bytes)) {
      it.file = storePdf(p, bytes);
      it.state = "ready";
    } else if (res.status === 403 || /html/i.test(res.headers.get("content-type") ?? "")) {
      it.state = "browser";
      it.note = "网站不让程序下载，需在浏览器中下载";
    } else {
      it.state = "failed";
      it.note = `下载失败（HTTP ${res.status}）`;
    }
  } catch (e) {
    it.state = "failed";
    it.note = `下载失败：${errMsg(e)}`;
  }
}

/** Open blocked PDFs in the browser and wait (≤5 min) for them to appear in Downloads. */
async function waitForBrowser(job: Job, byUid: Map<string, Paper>, s: Settings) {
  const pending = job.items.filter((i) => i.state === "browser");
  if (!pending.length || job.auto || !s.openBrowserForBlocked) return;
  for (const it of pending.slice(0, 10)) {
    openUrl(byUid.get(it.uid)!.pdfUrl);
    await sleep(500);
  }
  job.status = "waiting";
  job.waitUntil = Date.now() + 5 * 60_000;
  while (Date.now() < job.waitUntil && !job.skipWait) {
    await sleep(2000);
    let left = 0;
    for (const it of job.items) {
      if (it.state !== "browser") continue;
      const p = byUid.get(it.uid)!;
      const f = findInDownloads(p, s.downloadsDir);
      if (f) adopt(p, f, it);
      else left++;
    }
    if (!left) break;
  }
  job.waitUntil = undefined;
}

// ---------------------------------------------------------------- PDF assembly

async function printHtml(html: string, outPdf: string): Promise<boolean> {
  Deno.mkdirSync(TMP_DIR, { recursive: true });
  const htmlPath = join(TMP_DIR, `${crypto.randomUUID()}.html`);
  Deno.writeTextFileSync(htmlPath, html);
  try {
    return await htmlToPdf(htmlPath, outPdf);
  } finally {
    try {
      Deno.removeSync(htmlPath);
    } catch { /* ignore */ }
  }
}

async function htmlDoc(html: string): Promise<PDFDocument | null> {
  const pdfPath = join(TMP_DIR, `${crypto.randomUUID()}.pdf`);
  try {
    if (!(await printHtml(html, pdfPath))) return null;
    return await PDFDocument.load(Deno.readFileSync(pdfPath));
  } catch (e) {
    log("htmlDoc failed", e);
    return null;
  } finally {
    try {
      Deno.removeSync(pdfPath);
    } catch { /* ignore */ }
  }
}

async function buildMerged(job: Job, papers: Paper[], entries: Entry[], subtitle: string, outPath: string) {
  const docs: (PDFDocument | null)[] = [];
  for (const it of job.items) {
    let doc: PDFDocument | null = null;
    if (it.state === "ready" && it.file) {
      try {
        doc = await PDFDocument.load(Deno.readFileSync(it.file), { ignoreEncryption: true, updateMetadata: false });
      } catch (e) {
        it.state = "failed";
        it.note = "PDF 无法解析，未能合并";
        log(`cannot parse ${it.file}`, errMsg(e));
      }
    }
    docs.push(doc);
  }
  entries.forEach((e, i) => (e.missing = !docs[i]));
  const missing = entries.filter((e) => e.missing);
  let placeholders = missing.length ? await htmlDoc(placeholderHtml(missing)) : null;
  if (placeholders && placeholders.getPageCount() !== missing.length) placeholders = null;

  // page numbers in the contents depend on the contents' own length: re-render until stable
  const counts = docs.map((d) => (d ? d.getPageCount() : 1));
  let coverPages = 1;
  let cover: PDFDocument | null = null;
  for (let pass = 0; pass < 3; pass++) {
    let page = coverPages + 1;
    entries.forEach((e, i) => {
      e.startPage = page;
      page += counts[i];
    });
    cover = (await htmlDoc(coverHtml(job.title, subtitle, entries))) ?? (await textContents(job.title, subtitle, entries));
    if (cover.getPageCount() === coverPages) break;
    coverPages = cover.getPageCount();
  }

  const out = await PDFDocument.create();
  for (const pg of await out.copyPages(cover!, cover!.getPageIndices())) out.addPage(pg);
  const marks = [{ title: "目录", page: 0 }];
  let ph = 0;
  for (const [i, doc] of docs.entries()) {
    marks.push({ title: `${i + 1}. ${plainTitle(papers[i].title)}`, page: out.getPageCount() });
    let copied = false;
    if (doc) {
      try {
        for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
        copied = true;
      } catch (e) {
        job.items[i].note = "PDF 合并失败";
        log(`copyPages failed for ${papers[i].uid}`, errMsg(e));
      }
    }
    if (!copied) {
      const src = doc === null && placeholders ? placeholders : await textPlaceholder(papers[i]);
      const idx = src === placeholders ? ph++ : 0;
      const [pg] = await out.copyPages(src, [idx]);
      out.addPage(pg);
    }
  }
  addOutline(out, marks);
  out.setTitle(job.title);
  out.setCreator(`${APP_NAME} ${VERSION}`);
  out.setProducer("PreprintRadar + pdf-lib");
  Deno.writeFileSync(outPath, await out.save());
}

async function buildSeparate(job: Job, papers: Paper[], entries: Entry[], subtitle: string, folder: string) {
  Deno.mkdirSync(folder, { recursive: true });
  const width = Math.max(2, String(papers.length).length);
  papers.forEach((p, i) => {
    const it = job.items[i];
    if (it.state !== "ready" || !it.file) {
      entries[i].missing = true;
      return;
    }
    const year = (p.published || p.updated).slice(0, 4);
    const name = `${String(i + 1).padStart(width, "0")} ${
      safeFilename(`${p.authors.length ? surname(p.authors[0]) + " " : ""}${year} - ${p.title}`, 100)
    }.pdf`;
    copyFileSync(it.file, join(folder, name));
    entries[i].file = name;
  });
  const index = join(folder, "00 目录与摘要.pdf");
  if (!(await printHtml(digestHtml(job.title, subtitle, entries), index))) {
    Deno.writeFileSync(index, await (await textContents(job.title, subtitle, entries)).save());
  }
}

async function buildDigest(job: Job, entries: Entry[], subtitle: string, outPath: string) {
  if (!(await printHtml(digestHtml(job.title, subtitle, entries), outPath))) {
    Deno.writeFileSync(outPath, await (await textContents(job.title, subtitle, entries)).save());
  }
}

function uniquePath(dir: string, stem: string, suffix: string): string {
  let path = join(dir, stem + suffix);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${stem} (${n})${suffix}`);
  return path;
}

async function runJob(job: Job, papers: Paper[]) {
  const s = db.getSettings();
  const byUid = new Map(papers.map((p) => [p.uid, p]));
  if (job.mode !== "digest") {
    for (const it of job.items) await acquire(byUid.get(it.uid)!, it, s.downloadsDir);
    await waitForBrowser(job, byUid, s);
  }
  job.status = "building";
  Deno.mkdirSync(s.exportDir, { recursive: true });
  const rec = db.recInfo(papers.map((p) => p.uid));
  const entries: Entry[] = papers.map((p) => ({ paper: p, matched: rec.get(p.uid)?.matched }));
  const nA = papers.filter((p) => p.source === "arxiv").length;
  const stamp = stampLocal();
  const subtitle = `${papers.length} 篇 · arXiv ${nA} · ChemRxiv ${papers.length - nA} · ${stamp.slice(0, 10)} ${
    stamp.slice(11, 13)
  }:${stamp.slice(13)} 生成`;
  const stem = `${stamp} ${safeFilename(job.title, 60)}`;

  if (job.mode === "merged") {
    job.output = uniquePath(s.exportDir, stem, ".pdf");
    await buildMerged(job, papers, entries, subtitle, job.output);
  } else if (job.mode === "separate") {
    job.output = uniquePath(s.exportDir, stem, "");
    await buildSeparate(job, papers, entries, subtitle, job.output);
  } else {
    job.output = uniquePath(s.exportDir, stem, " 摘要.pdf");
    await buildDigest(job, entries, subtitle, job.output);
  }
  const nMissing = job.mode === "digest" ? 0 : entries.filter((e) => e.missing).length;
  db.addExport({ mode: job.mode, title: job.title, n: papers.length, nMissing, path: job.output, status: "ok" });
  job.status = "done";
  job.finishedAt = new Date().toISOString();
  job.message = nMissing ? `已导出，${nMissing} 篇未包含 PDF（见目录中的链接）` : "已导出";
  log(`export ${job.id} done → ${job.output} (${nMissing} missing)`);
}
