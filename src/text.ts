import { stripTex } from "./query.ts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Collapse whitespace; NFC so "Inácio" (decomposed, drawn with a gap by some fonts) becomes "Inácio". */
export const squash = (s: string) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

/**
 * Crossref titles/abstracts arrive as JATS/HTML fragments. Paragraphs are kept (blank line between),
 * sub/superscripts become TeX ("CO$_{2}$") so one renderer handles arXiv and ChemRxiv alike.
 */
const subSup = (s: string) =>
  s
    // Crossref pretty-prints JATS ("CO\n      <sub>2</sub>"); a subscript never follows a space
    .replace(/\s+(<(?:jats:)?su[bp]>)/gi, "$1")
    .replace(/<(?:jats:)?sub>([\s\S]*?)<\/(?:jats:)?sub>/gi, (_, x: string) => `$_{${stripTags(x).trim()}}$`)
    .replace(/<(?:jats:)?sup>([\s\S]*?)<\/(?:jats:)?sup>/gi, (_, x: string) => `$^{${stripTags(x).trim()}}$`);

/** Formatting tags that some servers escape a second time ("&lt;em&gt;Mycobacterium&lt;/em&gt;"). */
const INLINE_TAGS = /<\/?(?:i|b|em|strong|u|scp|sc|span|small|tt|font|italic|bold)(?:\s[^<>]*)?>/gi;

export function htmlishToText(s: string): string {
  const withMarks = subSup(s.replace(/<(jats:)?title>[\s\S]*?<\/(jats:)?title>/gi, ""))
    .replace(/<\/(?:jats:)?p>|<br\s*\/?>/gi, "\n\n");
  // decode, then clean markup that only appears after decoding — but leave a real "p < 0.05" alone
  return subSup(decodeEntities(stripTags(withMarks))).replace(INLINE_TAGS, "")
    .split(/\n\s*\n/)
    .map(squash)
    .filter(Boolean)
    .join("\n\n");
}

/** Plain text for file names, PDF bookmarks and tooltips. */
export function plainTitle(s: string): string {
  return squash(stripTex(s));
}

/** A Windows-safe file name stem (no extension). */
export function safeFilename(s: string, max = 110): string {
  // deno-lint-ignore no-control-regex
  let out = plainTitle(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "") + "…";
  out = out.replace(/[. ]+$/, "");
  return out || "untitled";
}

export function surname(author: string): string {
  const parts = squash(author).split(" ");
  return parts[parts.length - 1] || author;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** "2026-10-21 1430" in local time */
export function stampLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
