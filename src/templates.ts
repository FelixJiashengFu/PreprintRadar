/** HTML pages printed to PDF by headless Edge: merged-collection cover, placeholders, digests. */
import { APP_NAME, VERSION } from "./meta.ts";
import { escapeHtml, texToHtml } from "./render.ts";
import { SOURCES, sourceInfo, sourceName } from "./sources/registry.ts";
import type { Paper } from "./types.ts";

export interface Entry {
  paper: Paper;
  /** merged mode: first page of this paper in the combined PDF */
  startPage?: number;
  /** the PDF itself could not be included */
  missing?: boolean;
  /** separate mode: file name inside the export folder */
  file?: string;
  matched?: string[];
}

// 书香 for print: ink on white paper (no tinted backgrounds to waste toner), 楷体 headings, a vermilion seal
const CSS = `
@page { size: A4; margin: 16mm 16mm 17mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.55 Cambria, Georgia, "Times New Roman", "SimSun", "宋体", serif; color: #2a241d; }
a { color: #8e2820; text-decoration: none; }
sub, sup { font-size: 72%; line-height: 0; }
.brand { display: flex; align-items: center; gap: 2.4mm; color: #a8322a; font: 600 10.5pt/1 Cambria, "KaiTi", "楷体", serif; letter-spacing: .12em; }
.brand svg { width: 7mm; height: 7mm; transform: rotate(-4deg); }
h1 { font: 600 24pt/1.25 Cambria, "KaiTi", "楷体", serif; letter-spacing: .1em; margin: 5mm 0 1.2mm; }
.meta { color: #6c6051; font: 10pt/1.5 Cambria, "FangSong", "仿宋", serif; padding-bottom: 3mm; margin-bottom: 4mm; border-bottom: .9mm double #cbbc9f; }
.entry { display: grid; grid-template-columns: 9mm 1fr auto; column-gap: 3mm; padding: 2.8mm 0; border-top: .2mm dotted #cbbc9f; break-inside: avoid; }
.meta + .entry { border-top: 0; }
.n { font: 700 12pt/1.2 Cambria, serif; color: #a8322a; }
.t { font: 700 11.5pt/1.34 Cambria, Georgia, "Times New Roman", "SimSun", serif; color: #1f1a14; }
.au { color: #5a4f42; margin-top: .8mm; font-style: italic; }
.line { color: #7a6e5d; font: 8.8pt/1.5 Cambria, "FangSong", "仿宋", serif; margin-top: .8mm; display: flex; flex-wrap: wrap; gap: 0 2.6mm; align-items: center; }
.badge { display: inline-block; padding: 0 1.4mm; border: .25mm solid currentColor; border-radius: .5mm; font: 700 7.4pt/1.45 Cambria, serif; letter-spacing: .05em; }
${SOURCES.map((s) => `.badge.${s.id} { color: ${s.color}; }`).join("\n")}
.pg { color: #a8322a; font: 600 10pt/1.3 Cambria, "KaiTi", "楷体", serif; white-space: nowrap; text-align: right; }
.warn { color: #92580f; font-weight: 600; }
.kw { color: #a8322a; }
.abs { margin-top: 1.8mm; color: #2a241d; text-align: justify; line-height: 1.65; }
.abs p { margin: 0 0 1.5mm; }
.digest .entry { grid-template-columns: 9mm 1fr; break-inside: auto; }
.digest .head { break-inside: avoid; break-after: avoid; }
.ph { height: 260mm; overflow: hidden; break-after: page; }
.ph:last-child { break-after: auto; }
.banner { border: .3mm solid #d9b98a; border-left: 1.2mm solid #a8322a; color: #6c4a14; padding: 2.6mm 3.6mm; margin-bottom: 5mm; word-break: break-all; font: 9.6pt/1.55 Cambria, "FangSong", "仿宋", serif; }
.ph .t { font-size: 15.5pt; }
.ph h3 { font: 600 11.5pt/1.3 Cambria, "KaiTi", "楷体", serif; letter-spacing: .2em; margin: 6mm 0 1.5mm; color: #a8322a; }
footer { margin-top: 7mm; padding-top: 2.5mm; border-top: .2mm solid #cbbc9f; color: #9a8d7a; font: 8.4pt/1.5 Cambria, "FangSong", "仿宋", serif; letter-spacing: .04em; }
`;

const LOGO = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
<rect x="12" y="12" width="232" height="232" rx="30" fill="#ad3329"/>
<rect x="31" y="31" width="194" height="194" rx="14" fill="none" stroke="#fbf1e2" stroke-width="7"/>
<g font-family="KaiTi, 楷体, serif" font-size="86" fill="#fbf1e2" stroke="#fbf1e2" stroke-width="3.2" text-anchor="middle">
<text x="128" y="117">雷</text><text x="128" y="207">达</text></g></svg>`;

const fmtDate = (iso: string) => (iso ?? "").slice(0, 10);
const idText = (p: Paper) =>
  p.source === "arxiv" ? `arXiv:${p.extId}${p.version > 1 ? `v${p.version}` : ""}` : String(p.doi ?? p.extId);

function authorsText(p: Paper, max: number) {
  const a = p.authors;
  return a.length > max ? `${a.slice(0, max).join(", ")} 等 ${a.length} 位作者` : a.join(", ");
}

function lineHtml(e: Entry): string {
  const p = e.paper;
  const parts = [
    `<span class="badge ${p.source}">${escapeHtml(sourceName(p.source))}</span>`,
    `<span>${escapeHtml(fmtDate(p.updated || p.published))}</span>`,
    `<a href="${escapeHtml(p.url)}">${escapeHtml(idText(p))}</a>`,
  ];
  if (p.source === "arxiv" && p.categories.length) parts.push(`<span>${escapeHtml(p.categories.slice(0, 3).join(" · "))}</span>`);
  if (e.missing) parts.push(`<span class="warn">PDF 未包含 · <a href="${escapeHtml(p.pdfUrl)}">在浏览器中打开</a></span>`);
  return `<div class="line">${parts.join("")}</div>`;
}

function shell(title: string, body: string, cls = ""): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${CSS}</style></head><body class="${cls}">${body}</body></html>`;
}

function header(title: string, subtitle: string) {
  return `<div class="brand">${LOGO}<span>${APP_NAME}</span></div>` +
    `<h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(subtitle)}</div>`;
}

const footer = (extra = "") => `<footer>由 ${APP_NAME} v${VERSION} 生成${extra}</footer>`;

export function coverHtml(title: string, subtitle: string, entries: Entry[]): string {
  const rows = entries.map((e, i) =>
    `<div class="entry"><div class="n">${i + 1}</div><div><div class="t">${texToHtml(e.paper.title)}</div>` +
    `<div class="au">${escapeHtml(authorsText(e.paper, 6))}</div>${lineHtml(e)}</div>` +
    `<div class="pg">${e.startPage ? `第 ${e.startPage} 页` : ""}</div></div>`
  ).join("");
  return shell(title, header(title, subtitle) + rows + footer(" · 左侧书签可跳转到每一篇"));
}

/** One page per paper whose PDF is missing: title, link and abstract. */
export function placeholderHtml(entries: Entry[]): string {
  const pages = entries.map(({ paper: p, matched }) => {
    const abs = p.abstract.length > 2600 ? p.abstract.slice(0, 2600).replace(/\s+\S*$/, "") + " …" : p.abstract;
    const why = sourceInfo(p.source).pdf === "browser" ? `${sourceName(p.source)} 只允许在浏览器中下载 PDF。` : "下载没有成功。";
    return `<section class="ph"><div class="banner"><b>这篇文章的 PDF 没有包含在合集中。</b>${why}` +
      `可在浏览器中打开：<a href="${escapeHtml(p.pdfUrl)}">${escapeHtml(p.pdfUrl)}</a></div>` +
      `<div class="t">${texToHtml(p.title)}</div><div class="au">${escapeHtml(authorsText(p, 25))}</div>` +
      lineHtml({ paper: p, matched }) + `<h3>摘要</h3><div class="abs">${texToHtml(abs, null, true)}</div></section>`;
  }).join("");
  return shell("placeholders", pages);
}

export function digestHtml(title: string, subtitle: string, entries: Entry[]): string {
  const rows = entries.map((e, i) =>
    `<div class="entry"><div class="n">${i + 1}</div><div><div class="head"><div class="t">${texToHtml(e.paper.title)}</div>` +
    `<div class="au">${escapeHtml(authorsText(e.paper, 12))}</div>${lineHtml(e)}` +
    (e.matched?.length ? `<div class="line kw">命中关键词：${escapeHtml(e.matched.join("、"))}</div>` : "") +
    (e.file ? `<div class="line">文件：${escapeHtml(e.file)}</div>` : "") +
    `</div><div class="abs">${texToHtml(e.paper.abstract, null, true)}</div></div></div>`
  ).join("");
  return shell(title, header(title, subtitle) + rows + footer(), "digest");
}
