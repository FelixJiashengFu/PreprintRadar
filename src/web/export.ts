/// <reference lib="dom" />
/**
 * One-click export in the browser. A web page may only fetch PDFs whose server sends CORS headers —
 * of our sources that is arXiv alone — so the others are listed as links (and get a placeholder page
 * in the merged PDF). The desktop app downloads all of them.
 */
import { PDFDocument } from "pdf-lib";
import { errMsg } from "../engine.ts";
import { politeFetch } from "../http.ts";
import { addOutline, textContents, textPlaceholder } from "../pdftext.ts";
import { sourceName } from "../sources/registry.ts";
import { digestHtml, type Entry } from "../templates.ts";
import { plainTitle, safeFilename, stampLocal, surname } from "../text.ts";
import type { ExportMode, Paper } from "../types.ts";
import { makeZip } from "../zip.ts";

export interface WebJob {
  id: string;
  mode: ExportMode;
  modeLabel: string;
  title: string;
  status: "running" | "building" | "done" | "error";
  auto: boolean;
  total: number;
  ready: number;
  browser: number;
  failed: number;
  pending: number;
  items: { uid: string; title: string; source: string; state: string; note?: string }[];
  /** blob: URL of the result; `openLabel` set when it is a page to open rather than a download */
  output?: string;
  filename?: string;
  openLabel?: string;
  links: { title: string; url: string; source: string }[];
  message?: string;
  waitLeftMs: number;
  finishedAt?: string;
}

const MODE_LABEL: Record<ExportMode, string> = {
  merged: "合并为一个PDF",
  separate: "逐篇PDF（压缩包）",
  digest: "摘要清单（打印版）",
};

const jobs = new Map<string, WebJob>();
export const getWebJob = (id: string) => jobs.get(id) ?? null;
export const webJobs = () => [...jobs.values()].reverse().slice(0, 6);

const hasPdfHeader = (b: Uint8Array) => new TextDecoder().decode(b.subarray(0, 1024)).includes("%PDF-");

async function fetchPdf(p: Paper): Promise<Uint8Array | null> {
  if (p.source !== "arxiv") return null;
  try {
    const r = await politeFetch(p.pdfUrl, { timeoutMs: 120_000, retries: 1 });
    const b = new Uint8Array(await r.arrayBuffer());
    return r.ok && hasPdfHeader(b) ? b : null;
  } catch {
    return null;
  }
}

function download(data: Uint8Array, type: string, filename: string): string {
  const url = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  return url;
}

function count(job: WebJob) {
  for (const k of ["ready", "browser", "failed", "pending"] as const) job[k] = job.items.filter((i) => i.state === k).length;
}

export function startWebExport(
  papers: Paper[],
  mode: ExportMode,
  title: string,
  matched: (uid: string) => string[] | undefined,
): WebJob {
  const job: WebJob = {
    id: Math.random().toString(36).slice(2, 10),
    mode,
    modeLabel: MODE_LABEL[mode],
    title,
    status: "running",
    auto: false,
    total: papers.length,
    ready: 0,
    browser: 0,
    failed: 0,
    pending: papers.length,
    items: papers.map((p) => ({ uid: p.uid, title: plainTitle(p.title), source: p.source, state: "pending" })),
    links: [],
    waitLeftMs: 0,
  };
  jobs.set(job.id, job);
  run(job, papers, matched).catch((e) => {
    job.status = "error";
    job.message = errMsg(e);
    job.finishedAt = new Date().toISOString();
  });
  return job;
}

async function run(job: WebJob, papers: Paper[], matched: (uid: string) => string[] | undefined) {
  const stamp = stampLocal();
  const day = stamp.slice(0, 10);
  const entries: Entry[] = papers.map((p) => ({ paper: p, matched: matched(p.uid) }));
  const stem = `${stamp} ${safeFilename(job.title, 60)}`;

  if (job.mode === "digest") {
    const html = digestHtml(job.title, `${papers.length} 篇 · ${day} 生成`, entries)
      .replace("</body>", "<script>addEventListener('load',()=>setTimeout(()=>print(),400))</script></body>");
    job.output = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    job.openLabel = "打开打印版";
    job.items.forEach((i) => (i.state = "ready"));
    count(job);
    job.status = "done";
    job.message = "点「打开打印版」，在打印窗口里选「另存为 PDF」";
    job.finishedAt = new Date().toISOString();
    return;
  }

  const pdfs: (Uint8Array | null)[] = [];
  for (const [i, p] of papers.entries()) {
    const it = job.items[i];
    const b = await fetchPdf(p);
    if (b) it.state = "ready";
    else if (p.source === "arxiv") {
      it.state = "failed";
      it.note = "下载失败";
    } else {
      it.state = "browser";
      it.note = "网页版只能链接";
    }
    pdfs.push(b);
    count(job);
  }
  job.links = papers.filter((_, i) => !pdfs[i]).map((p) => ({ title: plainTitle(p.title), url: p.pdfUrl, source: sourceName(p.source) }));
  job.status = "building";

  if (job.mode === "merged") {
    const docs = await Promise.all(
      pdfs.map((b) => b ? PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false }).catch(() => null) : null),
    );
    const subtitle = `${papers.length} papers · ${papers.length - job.links.length} full texts · ${day}`;
    const counts = docs.map((d) => (d ? d.getPageCount() : 1));
    const contents = entries.map((e, i) => ({ paper: e.paper, missing: !docs[i], startPage: 0 }));
    // page numbers depend on the contents' own length: re-render until stable
    let coverPages = 1;
    let cover = await textContents("Collection", subtitle, contents);
    for (let pass = 0; pass < 3; pass++) {
      let page = coverPages + 1;
      contents.forEach((c, i) => {
        c.startPage = page;
        page += counts[i];
      });
      cover = await textContents(`${papers.length} preprints, ${day}`, subtitle, contents);
      if (cover.getPageCount() === coverPages) break;
      coverPages = cover.getPageCount();
    }
    const out = await PDFDocument.create();
    for (const pg of await out.copyPages(cover, cover.getPageIndices())) out.addPage(pg);
    const marks = [{ title: "目录 Contents", page: 0 }];
    for (const [i, doc] of docs.entries()) {
      marks.push({ title: `${i + 1}. ${plainTitle(papers[i].title)}`, page: out.getPageCount() });
      let copied = false;
      if (doc) {
        try {
          for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
          copied = true;
        } catch { /* fall through to a placeholder */ }
      }
      if (!copied) {
        const ph = await textPlaceholder(papers[i]);
        const [pg] = await out.copyPages(ph, [0]);
        out.addPage(pg);
      }
    }
    addOutline(out, marks);
    out.setTitle(job.title);
    out.setCreator("PreprintRadar (web)");
    job.filename = `${stem}.pdf`;
    job.output = download(await out.save(), "application/pdf", job.filename);
  } else {
    const width = Math.max(2, String(papers.length).length);
    const files: { name: string; data: Uint8Array }[] = [
      { name: "00 目录与摘要.html", data: new TextEncoder().encode(digestHtml(job.title, `${papers.length} 篇 · ${day}`, entries)) },
    ];
    pdfs.forEach((b, i) => {
      const p = papers[i];
      if (!b) return;
      const year = (p.published || p.updated).slice(0, 4);
      const who = p.authors.length ? surname(p.authors[0]) + " " : "";
      files.push({ name: `${String(i + 1).padStart(width, "0")} ${safeFilename(`${who}${year} - ${p.title}`, 100)}.pdf`, data: b });
    });
    job.filename = `${stem}.zip`;
    job.output = download(makeZip(files), "application/zip", job.filename);
  }
  job.status = "done";
  job.finishedAt = new Date().toISOString();
  job.message = job.links.length ? `已下载；另外 ${job.links.length} 篇请点下面的链接在新标签页打开` : `已下载 ${job.filename}`;
}
