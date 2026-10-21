import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../http.ts";
import { toArxiv } from "../query.ts";
import { squash } from "../text.ts";
import type { Paper } from "../types.ts";
import type { ArxivProvider } from "./provider.ts";

const API = "https://export.arxiv.org/api/query";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

export interface ArxivQuery {
  /** search_query fragment from toArxiv(); null = no keyword constraint */
  query: string | null;
  cats?: string[];
  from?: Date;
  to?: Date;
  start?: number;
  max?: number;
  sort?: "date" | "relevance";
}

// deno-lint-ignore no-explicit-any
type X = any;

const txt = (v: X): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? String(v["#text"]) : v == null ? "" : String(v);

/** arXiv wants YYYYMMDDHHMM in GMT */
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 12);

export function buildSearchQuery(q: ArxivQuery): string | null {
  const parts: string[] = [];
  if (q.query) parts.push(`(${q.query})`);
  if (q.cats?.length) parts.push(q.cats.length === 1 ? `cat:${q.cats[0]}` : `(${q.cats.map((c) => `cat:${c}`).join(" OR ")})`);
  if (!parts.length) return null; // never ask for "everything on arXiv"
  if (q.from) parts.push(`submittedDate:[${stamp(q.from)} TO ${stamp(q.to ?? new Date())}]`);
  return parts.join(" AND ");
}

function toPaper(e: X): Paper | null {
  const m = txt(e.id).match(/arxiv\.org\/abs\/(.+?)(?:v(\d+))?$/);
  if (!m) return null;
  const extId = m[1];
  const version = Number(m[2] ?? 1);
  const links: X[] = e.link ?? [];
  const pdf = links.find((l) => l["@title"] === "pdf")?.["@href"] ?? `https://arxiv.org/pdf/${extId}v${version}`;
  const cats = [e["arxiv:primary_category"]?.["@term"], ...(e.category ?? []).map((c: X) => c["@term"])]
    .filter((c): c is string => typeof c === "string" && !!c);
  const comment = squash(txt(e["arxiv:comment"]));
  const journalRef = squash(txt(e["arxiv:journal_ref"]));
  return {
    uid: `arxiv:${extId}`,
    source: "arxiv",
    extId,
    version,
    title: squash(txt(e.title)),
    authors: (e.author ?? []).map((a: X) => squash(txt(a.name))).filter(Boolean),
    abstract: squash(txt(e.summary)),
    published: txt(e.published),
    updated: txt(e.updated) || txt(e.published),
    categories: [...new Set(cats)],
    doi: squash(txt(e["arxiv:doi"])) || `10.48550/arXiv.${extId}`,
    url: `https://arxiv.org/abs/${extId}`,
    pdfUrl: String(pdf).replace(/^http:/, "https:"),
    comment: comment || undefined,
    journalRef: journalRef || undefined,
  };
}

export async function searchArxiv(q: ArxivQuery): Promise<{ total: number; papers: Paper[] }> {
  const sq = buildSearchQuery(q);
  if (!sq) return { total: 0, papers: [] };
  const params = new URLSearchParams({
    search_query: sq,
    start: String(q.start ?? 0),
    max_results: String(q.max ?? 50),
    sortBy: q.sort === "relevance" ? "relevance" : "submittedDate",
    sortOrder: "descending",
  });
  const xml = await fetchText(`${API}?${params}`, { accept: "application/atom+xml", timeoutMs: 45_000 });
  const feed = parser.parse(xml)?.feed;
  if (!feed) throw new Error("arXiv 返回了无法解析的数据");
  const entries: X[] = feed.entry ?? [];
  const err = entries.find((e) => txt(e.id).includes("/api/errors"));
  if (err) throw new Error(`arXiv 查询有误：${squash(txt(err.summary))}`);
  return {
    total: Number(txt(feed["opensearch:totalResults"])) || 0,
    papers: entries.map(toPaper).filter((p): p is Paper => p !== null),
  };
}

/** Everything matching `query`/`cats` submitted in [from, to], newest first, up to `cap`. */
export async function arxivWindow(query: string | null, cats: string[], from: Date, to: Date, cap = 300) {
  const out: Paper[] = [];
  const pageSize = 100;
  for (let start = 0; start < cap; start += pageSize) {
    const max = Math.min(pageSize, cap - start);
    const { total, papers } = await searchArxiv({ query, cats, from, to, start, max });
    out.push(...papers);
    if (papers.length < max || out.length >= total) break;
  }
  return out;
}

/** The official API — used by the desktop app (it has no CORS headers, so not by the web version). */
export const arxivApi: ArxivProvider = {
  window(ast, cats, from, to, cap) {
    const q = toArxiv(ast);
    return q || cats.length ? arxivWindow(q, cats, from, to, cap) : Promise.resolve([]);
  },
  search(ast, o) {
    return searchArxiv({ query: toArxiv(ast), from: o.from, start: o.page * o.size, max: o.size, sort: o.sort });
  },
};
