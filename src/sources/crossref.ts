/**
 * Every source except arXiv comes from the Crossref REST API. Each preprint server registers a DOI —
 * abstract included — for every posting within minutes, so one client covers them all; they differ
 * only in DOI prefix, DOI shape and where the PDF lives.
 *
 * ChemRxiv moved to Wiley's platform in 2026 (old API gone, site behind a Cloudflare challenge);
 * bioRxiv/medRxiv moved from DOI prefix 10.1101 to 10.64898 the same year.
 */
import { fetchJson } from "../http.ts";
import { htmlishToText, squash } from "../text.ts";
import type { Paper, Source } from "../types.ts";

// deno-lint-ignore no-explicit-any
type X = any;
export type CrossrefSource = Exclude<Source, "arxiv">;

const API = "https://api.crossref.org/works";
const SELECT = "DOI,title,author,abstract,created,posted,URL,link,resource,license,subject,group-title";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Ident {
  base: string;
  version: number;
}

interface Def {
  prefixes: string[];
  /** which records under a shared prefix belong to this source */
  accept?: (doi: string) => boolean;
  ident: (doi: string) => Ident | null;
  pdf: (doi: string, id: Ident, links: string[], landing: string) => string;
  /** Crossref's group-title is a subject area for this source (not e.g. "In Review") */
  groupIsSubject?: boolean;
}

const byRe = (re: RegExp) => (doi: string): Ident | null => {
  const m = doi.match(re);
  return m ? { base: m[1].toLowerCase(), version: Number(m[2] ?? 1) } : null;
};
const linkWith = (links: string[], re: RegExp) => links.find((u) => re.test(u));

/**
 * 10.26434/chemrxiv.15010776/v1   (2026–, Wiley)
 * 10.26434/chemrxiv-2023-ab12c-v2  (2021–2026, Cambridge Open Engage)
 * 10.26434/chemrxiv.12345678.v1   (–2021, Figshare)
 */
export function parseChemrxivDoi(doi: string): Ident | null {
  const m = doi.toLowerCase().match(/^10\.26434\/chemrxiv[.-]?(.+?)(?:[/.-]v(\d+))?$/);
  return m ? { base: m[1], version: Number(m[2] ?? 1) } : null;
}

/** bioRxiv and medRxiv share a prefix; medRxiv numbers have 8 digits, bioRxiv 6 (checked against Crossref's institution field) */
export const isMedrxivDoi = (doi: string) => /\.\d{8}$/.test(doi);
const rxivIdent = byRe(/^10\.(?:64898|1101)\/(.+)$/i);

export const DEFS: Record<CrossrefSource, Def> = {
  chemrxiv: {
    prefixes: ["10.26434"],
    ident: parseChemrxivDoi,
    pdf: (doi, _id, links) => linkWith(links, /\/doi\/pdf\//) ?? `https://chemrxiv.org/doi/pdf/${doi}`,
  },
  biorxiv: {
    prefixes: ["10.64898", "10.1101"],
    accept: (doi) => !isMedrxivDoi(doi),
    ident: rxivIdent,
    pdf: (doi) => `https://www.biorxiv.org/content/${doi}.full.pdf`,
    groupIsSubject: true,
  },
  medrxiv: {
    prefixes: ["10.64898", "10.1101"],
    accept: isMedrxivDoi,
    ident: rxivIdent,
    pdf: (doi) => `https://www.medrxiv.org/content/${doi}.full.pdf`,
    groupIsSubject: true,
  },
  researchsquare: {
    prefixes: ["10.21203"],
    ident: byRe(/rs\.3\.(rs-\d+)\/v(\d+)$/i),
    pdf: (_doi, id) => `https://www.researchsquare.com/article/${id.base}/v${id.version}.pdf`,
  },
  preprints: {
    prefixes: ["10.20944"],
    ident: byRe(/preprints(\d{6}\.\d+)\.v(\d+)$/i),
    pdf: (_doi, id) => `https://www.preprints.org/manuscript/${id.base}/v${id.version}/download`,
    groupIsSubject: true,
  },
  beilstein: {
    prefixes: ["10.3762"],
    accept: (doi) => /\/bxiv\./i.test(doi),
    ident: byRe(/bxiv\.(\d{4}\.\d+)\.v(\d+)$/i),
    pdf: (_doi, id, links) =>
      linkWith(links, /\/download\/pdf\//) ??
        `https://www.beilstein-archives.org/xiv/download/pdf/${id.base.replace(".", "")}-pdf`,
  },
  ssrn: {
    prefixes: ["10.2139"],
    ident: byRe(/ssrn\.(\d+)$/i),
    pdf: (_doi, id) => `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${id.base}`,
  },
  eartharxiv: {
    prefixes: ["10.31223"],
    ident: byRe(/^10\.31223\/([\w.-]+)$/i),
    pdf: (_doi, _id, links, landing) => linkWith(links, /\/download\//) ?? landing,
    groupIsSubject: true,
  },
  essoar: {
    prefixes: ["10.22541"],
    accept: (doi) => /\/essoar\./i.test(doi),
    ident: byRe(/essoar\.([\w.]+?)(?:\/v(\d+))?$/i),
    pdf: (doi) => `https://essopenarchive.org/doi/pdf/${doi}`,
  },
  authorea: {
    prefixes: ["10.22541"],
    accept: (doi) => /\/authorea\./i.test(doi),
    ident: byRe(/authorea\.([\w.]+?)(?:\/v(\d+))?$/i),
    pdf: (_doi, _id, links, landing) => linkWith(links, /\/pdf\//) ?? landing,
  },
  engrxiv: {
    prefixes: ["10.31224"],
    ident: byRe(/^10\.31224\/([\w.-]+)$/i),
    pdf: (_doi, _id, _links, landing) => landing,
  },
};

function dateFromParts(d: X): string | null {
  const p = d?.["date-parts"]?.[0];
  if (!Array.isArray(p) || !p[0]) return null;
  return new Date(Date.UTC(p[0], (p[1] ?? 1) - 1, p[2] ?? 1)).toISOString();
}

export function crossrefToPaper(source: CrossrefSource, it: X): Paper | null {
  const def = DEFS[source];
  const doi = String(it.DOI ?? "");
  if (def.accept && !def.accept(doi)) return null;
  const id = def.ident(doi);
  const title = htmlishToText(it.title?.[0] ?? "");
  if (!id || !title) return null;
  const when = it.created?.["date-time"] ?? dateFromParts(it.posted) ?? new Date().toISOString();
  const links: string[] = (it.link ?? []).map((l: X) => String(l.URL ?? ""));
  const landing = it.resource?.primary?.URL ?? `https://doi.org/${doi}`;
  const group = it["group-title"];
  return {
    uid: `${source}:${id.base}`,
    source,
    extId: id.base,
    version: id.version,
    title,
    authors: (it.author ?? [])
      .map((a: X) => squash(a.name ?? [a.given, a.family].filter(Boolean).join(" ")))
      .filter(Boolean),
    abstract: htmlishToText(it.abstract ?? ""),
    published: when,
    updated: when,
    categories: [...(it.subject ?? []), ...(def.groupIsSubject && group ? [String(group)] : [])],
    doi,
    url: landing,
    pdfUrl: def.pdf(doi, id, links, landing),
    license: it.license?.[0]?.URL,
  };
}

function keepNewest(map: Map<string, Paper>, p: Paper) {
  const old = map.get(p.uid);
  if (!old || p.version > old.version) map.set(p.uid, p);
}

const filterFor = (prefixes: string[], extra: string[]) =>
  [...prefixes.map((p) => `prefix:${p}`), "type:posted-content", ...extra].join(",");

// sources sharing a prefix (bioRxiv/medRxiv, ESSOAr/Authorea) share one download per run
const windowCache = new Map<string, { at: number; day: string; items: X[]; truncated: boolean }>();

async function prefixWindow(prefixes: string[], day: string, cap: number, maxAgeMs: number) {
  const key = prefixes.join("+");
  const hit = windowCache.get(key);
  if (hit && hit.day <= day && Date.now() - hit.at < maxAgeMs) return hit;
  const items: X[] = [];
  let cursor = "*";
  let truncated = false;
  for (;;) {
    const params = new URLSearchParams({
      filter: filterFor(prefixes, [`from-created-date:${day}`]),
      rows: "1000",
      cursor,
      select: SELECT,
      sort: "created",
      order: "desc",
    });
    const j: X = await fetchJson(`${API}?${params}`, { timeoutMs: 60_000 });
    const page: X[] = j?.message?.items ?? [];
    items.push(...page);
    const next = j?.message?.["next-cursor"];
    if (page.length < 1000 || !next) break;
    if (items.length >= cap) {
      truncated = true;
      break;
    }
    cursor = next;
  }
  const entry = { at: Date.now(), day, items, truncated };
  windowCache.set(key, entry);
  return entry;
}

/** Everything a source posted since `since` (newest version of each), capped for the big servers. */
export async function crossrefWindow(
  source: CrossrefSource,
  since: Date,
  opts: { cap?: number; maxAgeMs?: number } = {},
): Promise<{ papers: Paper[]; truncated: boolean }> {
  const def = DEFS[source];
  const { items, truncated } = await prefixWindow(def.prefixes, isoDay(since), opts.cap ?? 6000, opts.maxAgeMs ?? 600_000);
  const byBase = new Map<string, Paper>();
  for (const it of items) {
    const p = crossrefToPaper(source, it);
    if (p && Date.parse(p.published) >= since.getTime()) keepNewest(byBase, p);
  }
  return { papers: [...byBase.values()], truncated };
}

/** Relevance (or date) search, for date ranges too long to scan. */
export async function crossrefSearch(
  source: CrossrefSource,
  query: string,
  opts: { from?: Date; rows?: number; offset?: number; sort?: "relevance" | "date"; author?: boolean } = {},
): Promise<{ total: number; papers: Paper[] }> {
  const def = DEFS[source];
  const params = new URLSearchParams({
    filter: filterFor(def.prefixes, opts.from ? [`from-created-date:${isoDay(opts.from)}`] : []),
    rows: String(opts.rows ?? 25),
    offset: String(opts.offset ?? 0),
    select: SELECT,
    sort: query && opts.sort !== "date" ? "relevance" : "created",
    order: "desc",
  });
  if (query) params.set(opts.author ? "query.author" : "query", query);
  const j: X = await fetchJson(`${API}?${params}`, { timeoutMs: 60_000 });
  const map = new Map<string, Paper>();
  for (const it of j?.message?.items ?? []) {
    const p = crossrefToPaper(source, it);
    if (p) keepNewest(map, p);
  }
  return { total: Number(j?.message?.["total-results"]) || 0, papers: [...map.values()] };
}
