/**
 * arXiv for the web version. Every arXiv paper gets a DataCite DOI (10.48550/arXiv.<id>) within
 * hours of announcement, with abstract and categories, and DataCite's REST API allows cross-origin
 * requests. Queries use DataCite's Elasticsearch query-string syntax; like everywhere else, the
 * translated query only fetches a superset and the local evaluator decides what matches.
 */
import { fetchJson } from "../http.ts";
import { type QNode, type TermNode, wrapBool as wrap } from "../query.ts";
import { squash } from "../text.ts";
import type { Paper } from "../types.ts";
import type { ArxivProvider } from "./provider.ts";

const API = "https://api.datacite.org/dois";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// deno-lint-ignore no-explicit-any
type X = any;

function value(t: TermNode): string {
  const text = t.text.replace(/["“”\\]/g, "").trim();
  if (/^[\p{L}\p{N}]+$/u.test(text)) return t.prefix ? `${text}*` : text;
  const words = text.split(/[\s-]+/).filter(Boolean);
  // a wildcard can't sit inside a phrase: ask for all the words instead (the local filter checks adjacency)
  if (t.prefix && words.every((w) => /^[\p{L}\p{N}]+$/u.test(w))) {
    return `(${words.map((w, i) => (i === words.length - 1 ? `${w}*` : w)).join(" AND ")})`;
  }
  return `"${text}"`;
}

function termToEs(t: TermNode): string {
  const v = value(t);
  switch (t.field) {
    case "ti":
      return `titles.title:${v}`;
    case "abs":
      return `descriptions.description:${v}`;
    case "au":
      return `creators.name:${v}`;
    default:
      return `(titles.title:${v} OR descriptions.description:${v})`;
  }
}

const hasNot = (n: QNode): boolean => n.t === "not" || (n.t !== "term" && n.kids.some(hasNot));

/** Elasticsearch query string for a superset of the matches; null = no keyword constraint. */
export function toDatacite(node: QNode | null): string | null {
  if (!node) return null;
  switch (node.t) {
    case "term":
      return termToEs(node);
    case "not":
      return null;
    case "or": {
      const parts = node.kids.map(toDatacite);
      return parts.some((p) => p === null) ? null : parts.map((p) => wrap(p!)).join(" OR ");
    }
    case "and": {
      const pos = node.kids.filter((k) => k.t !== "not").map(toDatacite).filter((p): p is string => p !== null);
      if (!pos.length) return null;
      let s = pos.map(wrap).join(" AND ");
      for (const k of node.kids) {
        if (k.t === "not" && !hasNot(k.kid)) {
          const neg = toDatacite(k.kid);
          if (neg) s = `${wrap(s)} AND NOT ${wrap(neg)}`;
        }
      }
      return s;
    }
  }
}

function buildQuery(ast: QNode | null, cats: string[], from?: Date, to?: Date): string | null {
  const parts: string[] = [];
  const q = toDatacite(ast);
  if (q) parts.push(`(${q})`);
  if (cats.length) parts.push(`(${cats.map((c) => `subjects.subject:"${c}"`).join(" OR ")})`);
  if (!parts.length) return null; // never ask for all of arXiv
  if (from) parts.push(`created:[${isoDay(from)} TO ${to ? isoDay(to) : "*"}]`);
  return parts.join(" AND ");
}

const flipName = (name: string) => {
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return squash(m ? `${m[2]} ${m[1]}` : name);
};

export function dataciteToPaper(d: X): Paper | null {
  const a = d?.attributes ?? {};
  const m = String(a.doi ?? d?.id ?? "").match(/arxiv\.(.+)$/i);
  const title = squash(a.titles?.[0]?.title ?? "");
  if (!m || !title) return null;
  const extId = m[1];
  const abstract = (a.descriptions ?? []).find((x: X) => x.descriptionType === "Abstract") ?? a.descriptions?.[0];
  const when = a.created ?? a.registered ?? new Date().toISOString();
  return {
    uid: `arxiv:${extId}`,
    source: "arxiv",
    extId,
    version: 1,
    title,
    authors: (a.creators ?? []).map((c: X) =>
      c.givenName && c.familyName ? squash(`${c.givenName} ${c.familyName}`) : flipName(String(c.name ?? ""))
    ).filter(Boolean),
    abstract: squash(abstract?.description ?? ""),
    published: when,
    updated: when,
    categories: (a.subjects ?? [])
      .filter((s: X) => s.subjectScheme === "arXiv")
      .map((s: X) => String(s.subject).match(/\(([^()]+)\)\s*$/)?.[1])
      .filter(Boolean),
    doi: `10.48550/arXiv.${extId}`,
    url: `https://arxiv.org/abs/${extId}`,
    pdfUrl: `https://arxiv.org/pdf/${extId}`,
  };
}

async function query(q: string, page: number, size: number, sort: "date" | "relevance") {
  const params = new URLSearchParams({ "client-id": "arxiv.content", query: q, "page[size]": String(size), "page[number]": String(page + 1) });
  if (sort === "date") params.set("sort", "-created");
  const j: X = await fetchJson(`${API}?${params}`, { timeoutMs: 30_000 });
  return {
    total: Number(j?.meta?.total) || 0,
    papers: ((j?.data ?? []) as X[]).map(dataciteToPaper).filter((p): p is Paper => p !== null),
  };
}

export const arxivViaDatacite: ArxivProvider = {
  async window(ast, cats, from, to, cap) {
    const q = buildQuery(ast, cats, from, to);
    if (!q) return [];
    const out: Paper[] = [];
    for (let page = 0; out.length < cap; page++) {
      const r = await query(q, page, 100, "date");
      out.push(...r.papers);
      if (r.papers.length < 100 || out.length >= r.total) break;
    }
    return out;
  },
  async search(ast, o) {
    const q = buildQuery(ast, [], o.from);
    if (!q) return { total: 0, papers: [] };
    return await query(q, o.page, o.size, o.sort);
  },
};
