/**
 * Fetching, matching and scoring — shared by the desktop app and the web version. Storage stays with
 * the caller (SQLite on the desktop, localStorage in the browser); so does the arXiv provider.
 */
import { describe, evaluate, makeDoc, parseQuery, type QNode, QueryError, toCrossref, withField } from "./query.ts";
import { type Profile, scorePaper } from "./rank.ts";
import { type CrossrefSource, crossrefSearch, crossrefWindow } from "./sources/crossref.ts";
import type { ArxivProvider } from "./sources/provider.ts";
import { sourceInfo, sourceName } from "./sources/registry.ts";
import type { Paper, Source, Topic } from "./types.ts";

/** Message plus the underlying cause ("fetch failed" alone says nothing about DNS vs. TLS vs. proxy). */
export const errMsg = (e: unknown): string =>
  e instanceof Error ? (e.cause && e.cause !== e ? `${e.message}（${errMsg(e.cause)}）` : e.message) : String(e);

let arxiv: ArxivProvider | null = null;
export const useArxivProvider = (p: ArxivProvider) => void (arxiv = p);

export interface Candidate {
  paper: Paper;
  topicIds: number[];
  score: number;
  matched: string[];
}

/** Fetch candidates for the given topics and score the ones that match. Problems go to `notes`. */
export async function gatherCandidates(
  topics: Topic[],
  since: Date,
  until: Date,
  profile: Profile | null,
  notes: string[],
  opts: { fresh?: boolean } = {},
): Promise<{ candidates: Map<string, Candidate>; nFetched: number }> {
  const candidates = new Map<string, Candidate>();
  let nFetched = 0;

  // Crossref-backed sources are fetched once per run as a whole time window, shared by all topics
  const wanted = new Set<CrossrefSource>();
  for (const t of topics) for (const s of t.sources) if (s !== "arxiv") wanted.add(s);
  const pools = new Map<CrossrefSource, Paper[]>();
  for (const s of wanted) {
    try {
      const { papers, truncated } = await crossrefWindow(s, since, { maxAgeMs: opts.fresh ? 60_000 : undefined });
      pools.set(s, papers);
      nFetched += papers.length;
      if (truncated) notes.push(`${sourceName(s)} 这段时间的新文章太多，只检查了最新的一部分`);
    } catch (e) {
      notes.push(`${sourceName(s)} 获取失败：${errMsg(e)}`);
    }
  }

  for (const t of topics) {
    let ast: QNode | null;
    try {
      ast = parseQuery(t.query);
    } catch (e) {
      notes.push(`主题「${t.name}」的关键词有误：${errMsg(e)}`);
      continue;
    }
    const pool: Paper[] = [];
    // these sources have no categories to subscribe to, so a topic needs keywords to select from them
    if (ast) for (const s of t.sources) if (s !== "arxiv") pool.push(...(pools.get(s) ?? []));
    if (t.sources.includes("arxiv") && arxiv) {
      try {
        const ax = await arxiv.window(ast, t.arxivCats, since, until, 300);
        nFetched += ax.length;
        pool.push(...ax);
      } catch (e) {
        notes.push(`arXiv（${t.name}）获取失败：${errMsg(e)}`);
      }
    }
    for (const p of pool) {
      if (ast && !evaluate(ast, makeDoc(p))) continue;
      const s = scorePaper(p, ast, profile);
      const c = candidates.get(p.uid);
      if (!c) {
        candidates.set(p.uid, { paper: p, topicIds: [t.id], score: s.score, matched: s.matched });
      } else {
        if (!c.topicIds.includes(t.id)) c.topicIds.push(t.id);
        c.score = Math.max(c.score, s.score);
        c.matched = [...new Set([...c.matched, ...s.matched])];
      }
    }
  }
  return { candidates, nFetched };
}

/** Best first, but every topic gets its top two before the rest is filled by score. */
export function pickFair(cands: Candidate[], topics: Topic[], max: number): Candidate[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const chosen = new Set<Candidate>();
  for (const t of topics) {
    let k = 0;
    for (const c of sorted) {
      if (k >= 2 || chosen.size >= max) break;
      if (c.topicIds.includes(t.id)) {
        chosen.add(c);
        k++;
      }
    }
  }
  for (const c of sorted) {
    if (chosen.size >= max) break;
    chosen.add(c);
  }
  return [...chosen].sort((a, b) => b.score - a.score);
}

/** Try a topic definition on the last `days` days without saving anything. */
export async function previewTopic(
  t: Omit<Topic, "id" | "createdAt" | "updatedAt">,
  days: number,
  profile: Profile | null,
) {
  const now = new Date();
  const notes: string[] = [];
  const topic: Topic = { ...t, id: -1, createdAt: "", updatedAt: "" };
  const since = new Date(now.getTime() - days * 86_400_000);
  const { candidates, nFetched } = await gatherCandidates([topic], since, now, profile, notes);
  return { list: [...candidates.values()].sort((a, b) => b.score - a.score), nFetched, notes };
}

// ---------------------------------------------------------------- interactive search

export interface SearchParams {
  q: string;
  sources: Source[];
  /** null = any date */
  days: number | null;
  field: "all" | "ti" | "au";
  sort: "date" | "relevance";
  page: number;
}

const PAGE = 20;
const SCAN_LIMIT = 2500;
const DEADLINE_MS = 30_000;

/** A slow source (the arXiv API stalls now and then) must not hold up the others. */
function withDeadline(p: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 响应太慢（超过 ${DEADLINE_MS / 1000} 秒），请稍后再试`)), DEADLINE_MS);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const newestFirst = (a: Paper, b: Paper) => Date.parse(b.updated) - Date.parse(a.updated);

export async function searchAll(params: SearchParams, profile: Profile | null) {
  let ast: QNode | null = parseQuery(params.q);
  if (!ast) throw new QueryError("请输入关键词");
  if (params.field !== "all") ast = withField(ast, params.field);
  const query = ast;
  const from = params.days ? new Date(Date.now() - params.days * 86_400_000) : undefined;
  const notes: string[] = [];
  const found: Paper[] = [];
  let hasMore = false;

  const one = async (s: Source) => {
    if (s === "arxiv") {
      if (!arxiv) return;
      const r = await arxiv.search(query, { from, page: params.page, size: PAGE, sort: params.sort });
      found.push(...r.papers.filter((p) => evaluate(query, makeDoc(p))));
      if ((params.page + 1) * PAGE < r.total) hasMore = true;
      return;
    }
    // a short window of a small server is scanned completely; anything bigger goes to Crossref's search
    if (from && params.field !== "au" && sourceInfo(s).perDay * params.days! <= SCAN_LIMIT) {
      const { papers } = await crossrefWindow(s, from);
      const all = papers.filter((p) => evaluate(query, makeDoc(p))).sort(newestFirst);
      found.push(...all.slice(params.page * PAGE, (params.page + 1) * PAGE));
      if (all.length > (params.page + 1) * PAGE) hasMore = true;
    } else {
      // always by relevance: Crossref's date sort returns the newest records containing ANY query word,
      // which the strict local filter then throws away; the display order is applied below
      const rows = 60;
      const r = await crossrefSearch(s, toCrossref(query), {
        from,
        rows,
        offset: params.page * rows,
        sort: "relevance",
        author: params.field === "au",
      });
      found.push(...r.papers.filter((p) => evaluate(query, makeDoc(p))));
      if ((params.page + 1) * rows < r.total) hasMore = true;
    }
  };
  await Promise.all(
    params.sources.map((s) =>
      withDeadline(one(s), sourceName(s)).catch((e) => void notes.push(`${sourceName(s)} 检索失败：${errMsg(e)}`))
    ),
  );

  const results = found.map((p) => ({ paper: p, ...scorePaper(p, query, profile) }));
  if (params.sort === "relevance") results.sort((a, b) => b.score - a.score);
  else results.sort((a, b) => newestFirst(a.paper, b.paper));
  return { results, hasMore, interpreted: describe(query), notes };
}
