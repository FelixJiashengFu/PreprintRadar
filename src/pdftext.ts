/**
 * Plain-text PDF pages in a standard font (Latin only) — the desktop app's fallback when no browser
 * can print, and the web version's contents / placeholder pages.
 */
import { PDFDocument, PDFHexString, PDFName, type PDFFont, PDFString, rgb, StandardFonts } from "pdf-lib";
import { sourceInfo, sourceName } from "./sources/registry.ts";
import { plainTitle } from "./text.ts";
import type { Paper } from "./types.ts";

const TRANSLIT: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ι: "iota",
  κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma", τ: "tau",
  υ: "upsilon", φ: "phi", χ: "chi", ψ: "psi", ω: "omega", Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda",
  Ξ: "Xi", Π: "Pi", Σ: "Sigma", Φ: "Phi", Ψ: "Psi", Ω: "Omega", "→": "->", "←": "<-", "↔": "<->", "⇌": "<=>",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "∼": "~", "∞": "inf", "√": "sqrt", "′": "'", "″": "''",
};

/** What the standard fonts can draw (WinAnsi): Greek is spelled out, the rest becomes "?". */
export const winAnsi = (s: string) =>
  plainTitle(s).normalize("NFKC")
    .replace(/[Ͱ-Ͽ←-⋿′″]/g, (c) => TRANSLIT[c] ?? "?")
    .replace(/[‐-―−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff•…€™]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(" ")) {
    // a URL or a long formula wider than the page is cut by characters
    while (font.widthOfTextAtSize(word, size) > width) {
      let n = word.length - 1;
      while (n > 1 && font.widthOfTextAtSize(word.slice(0, n), size) > width) n--;
      if (line) lines.push(line);
      lines.push(word.slice(0, n));
      line = "";
      word = word.slice(n);
    }
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export type Block = { text: string; size: number; bold?: boolean; gap?: number; link?: string; muted?: boolean };

const INK = rgb(0.165, 0.141, 0.114);
const MUTED = rgb(0.42, 0.37, 0.31);
const LINK = rgb(0.56, 0.16, 0.13);

export async function simpleTextDoc(blocks: Block[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 785;
  for (const b of blocks) {
    const font = b.bold ? bold : regular;
    for (const line of wrap(winAnsi(b.text), font, b.size, 487)) {
      if (y < 60) {
        page = doc.addPage([595.28, 841.89]);
        y = 785;
      }
      page.drawText(line, { x: 54, y, size: b.size, font, color: b.link ? LINK : b.muted ? MUTED : INK });
      if (b.link) {
        const annot = doc.context.register(doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [54, y - 2, 54 + font.widthOfTextAtSize(line, b.size), y + b.size],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(b.link) },
        }));
        page.node.addAnnot(annot);
      }
      y -= b.size * 1.38;
    }
    y -= b.gap ?? 4;
  }
  return doc;
}

const idLine = (p: Paper) =>
  `${sourceName(p.source)} | ${p.source === "arxiv" ? `arXiv:${p.extId}` : p.doi} | ${(p.updated || p.published).slice(0, 10)}`;

/** Contents: numbered titles, authors, source line, page numbers or a link for missing PDFs. */
export function textContents(title: string, subtitle: string, entries: { paper: Paper; startPage?: number; missing?: boolean }[]) {
  return simpleTextDoc([
    { text: "PreprintRadar", size: 11, bold: true, gap: 2, muted: true },
    { text: title, size: 20, bold: true, gap: 3 },
    { text: subtitle, size: 10, gap: 16, muted: true },
    ...entries.flatMap((e, i) => [
      { text: `${i + 1}. ${e.paper.title}`, size: 11.5, bold: true, gap: 1 },
      { text: e.paper.authors.slice(0, 6).join(", ") + (e.paper.authors.length > 6 ? " et al." : ""), size: 9.5, gap: 1, muted: true },
      e.missing
        ? { text: `${idLine(e.paper)} | PDF not included - open: ${e.paper.pdfUrl}`, size: 9, gap: 9, link: e.paper.pdfUrl }
        : { text: `${idLine(e.paper)}${e.startPage ? ` | page ${e.startPage}` : ""}`, size: 9, gap: 9, muted: true },
    ]),
  ]);
}

/** One page standing in for a paper whose PDF could not be included. */
export function textPlaceholder(p: Paper) {
  const why = sourceInfo(p.source).pdf === "browser"
    ? `${sourceName(p.source)} only serves its PDFs to web browsers. Open it here:`
    : "The PDF could not be downloaded. Open it here:";
  return simpleTextDoc([
    { text: `PDF not included. ${why}`, size: 10, bold: true, gap: 2 },
    { text: p.pdfUrl, size: 9.5, gap: 14, link: p.pdfUrl },
    { text: p.title, size: 15, bold: true, gap: 4 },
    { text: p.authors.slice(0, 20).join(", "), size: 9.5, gap: 3, muted: true },
    { text: idLine(p), size: 9, gap: 12, muted: true, link: p.url },
    { text: "Abstract", size: 11, bold: true, gap: 3 },
    { text: p.abstract.slice(0, 2400), size: 10 },
  ]);
}

export function addOutline(doc: PDFDocument, marks: { title: string; page: number }[]) {
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs = marks.map(() => ctx.nextRef());
  marks.forEach((m, i) => {
    ctx.assign(
      refs[i],
      ctx.obj({
        Title: PDFHexString.fromText(m.title.length > 120 ? m.title.slice(0, 118) + "…" : m.title),
        Parent: root,
        Dest: [doc.getPage(m.page).ref, PDFName.of("XYZ"), null, null, null],
        ...(i > 0 ? { Prev: refs[i - 1] } : {}),
        ...(i < marks.length - 1 ? { Next: refs[i + 1] } : {}),
      }),
    );
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: marks.length }));
  doc.catalog.set(PDFName.of("Outlines"), root);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}
