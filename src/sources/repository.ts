/**
 * Repositories that register DOIs with DataCite rather than Crossref. Knowledge Commons Works (the MLA's
 * repository, works.hcommons.org) is where literature, history, philosophy and the other humanities post
 * preprints and papers: few of them use the preprint servers on Crossref. Its DataCite records carry
 * abstracts and subject headings ("Literature--Philosophy"). It also holds datasets, images and
 * recordings; only texts are kept.
 */
import { fetchJson } from "../http.ts";
import type { QNode } from "../query.ts";
import { squash } from "../text.ts";
import type { Paper, RepoSource, Source } from "../types.ts";
import { toDatacite } from "./datacite.ts";

// deno-lint-ignore no-explicit-any
type X = any;

const API = "https://api.datacite.org/dois";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Repo {
  prefix: string;
  landing: (doi: string) => string;
}

export const REPOS: Record<RepoSource, Repo> = {
  kcworks: { prefix: "10.17613", landing: (doi) => `https://works.hcommons.org/doi/${doi}` },
};

export const isRepoSource = (s: Source): s is RepoSource => s in REPOS;

/** DataCite's resourceTypeGeneral values that are texts someone could read as a paper. */
export const TEXT_TYPES = new Set([
  "Preprint",
  "JournalArticle",
  "Text",
  "BookChapter",
  "Book",
  "ConferencePaper",
  "ConferenceProceeding",
  "Report",
  "Dissertation",
  "Journal",
  "Standard",
]);

const flipName = (name: string) => {
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return squash(m ? `${m[2]} ${m[1]}` : name);
};

export function repoToPaper(source: RepoSource, d: X): Paper | null {
  const a = d?.attributes ?? {};
  const doi = String(a.doi ?? d?.id ?? "").toLowerCase();
  const repo = REPOS[source];
  if (!doi.startsWith(`${repo.prefix}/`)) return null;
  if (!TEXT_TYPES.has(String(a.types?.resourceTypeGeneral ?? ""))) return null;
  const title = squash(a.titles?.[0]?.title ?? "");
  if (!title) return null;
  const extId = doi.slice(repo.prefix.length + 1);
  const abstract = (a.descriptions ?? []).find((x: X) => x.descriptionType === "Abstract") ?? a.descriptions?.[0];
  const when = a.created ?? a.registered ?? new Date().toISOString();
  const landing = a.url || repo.landing(doi);
  return {
    uid: `${source}:${extId}`,
    source,
    extId,
    version: Number(a.version) || 1,
    title,
    authors: (a.creators ?? []).map((c: X) =>
      c.givenName && c.familyName ? squash(`${c.givenName} ${c.familyName}`) : flipName(String(c.name ?? ""))
    ).filter(Boolean),
    abstract: squash(abstract?.description ?? ""),
    published: when,
    updated: a.updated ?? when,
    categories: (a.subjects ?? []).map((s: X) => squash(String(s.subject ?? ""))).filter(Boolean).slice(0, 6),
    doi,
    url: landing,
    pdfUrl: landing,
    license: a.rightsList?.[0]?.rightsUri,
  };
}

/** The same work is sometimes deposited twice under two DOIs; keep the newer record of each title. */
function dedupe(papers: Paper[]): Paper[] {
  const byTitle = new Map<string, Paper>();
  for (const p of papers) {
    const key = p.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const old = byTitle.get(key);
    if (!old || p.published > old.published) byTitle.set(key, p);
  }
  return [...byTitle.values()];
}

async function page(source: RepoSource, q: string | null, n: number, size: number, sort: "date" | "relevance") {
  const params = new URLSearchParams({ prefix: REPOS[source].prefix, "page[size]": String(size), "page[number]": String(n + 1) });
  if (q) params.set("query", q);
  if (sort === "date") params.set("sort", "-created");
  const j: X = await fetchJson(`${API}?${params}`, { timeoutMs: 30_000 });
  const data: X[] = j?.data ?? [];
  return {
    total: Number(j?.meta?.total) || 0,
    count: data.length,
    papers: data.map((d) => repoToPaper(source, d)).filter((p): p is Paper => p !== null),
  };
}

/** Everything the repository registered since `since`, texts only, capped like the big Crossref servers. */
export async function repoWindow(
  source: RepoSource,
  since: Date,
  opts: { cap?: number } = {},
): Promise<{ papers: Paper[]; truncated: boolean }> {
  const cap = opts.cap ?? 6000, size = 1000, out: Paper[] = [];
  let truncated = false;
  for (let n = 0; ; n++) {
    const r = await page(source, `created:[${isoDay(since)} TO *]`, n, size, "date");
    out.push(...r.papers);
    if (r.count < size || (n + 1) * size >= r.total) break;
    if ((n + 1) * size >= cap) {
      truncated = true;
      break;
    }
  }
  return { papers: dedupe(out.filter((p) => Date.parse(p.published) >= since.getTime())), truncated };
}

/** Keyword search through DataCite's query string; the local evaluator still decides what matches. */
export async function repoSearch(
  source: RepoSource,
  ast: QNode | null,
  opts: { from?: Date; rows?: number; offset?: number; sort?: "relevance" | "date"; author?: boolean } = {},
): Promise<{ total: number; papers: Paper[] }> {
  const parts: string[] = [];
  const q = toDatacite(ast);
  if (q) parts.push(`(${q})`);
  if (opts.from) parts.push(`created:[${isoDay(opts.from)} TO *]`);
  if (!parts.length) return { total: 0, papers: [] };
  const rows = opts.rows ?? 25;
  const r = await page(source, parts.join(" AND "), Math.floor((opts.offset ?? 0) / rows), rows, opts.sort === "date" ? "date" : "relevance");
  return { total: r.total, papers: dedupe(r.papers) };
}
