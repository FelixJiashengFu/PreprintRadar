/**
 * Relevance score 0–100 = keyword evidence (title hits weigh 3×) + recency
 * + similarity to papers the user marked 👍 (minus 👎), via TF-IDF centroids.
 */
import { collectTerms, makeDoc, normalizeText, type QNode, termHits } from "./query.ts";
import type { Paper } from "./types.ts";

const STOP = new Set(
  `about above across after again against all also although among and another any are around as at based be been
  before being below between both but by can could does done due during each either enable enables enabled first
  for from further furthermore had has have here herein however how into its itself just less many may more most
  much must new not novel now often only other our over paper per present presents provide provides rather report
  reports several show shows shown since some study studies such than that the their them then there these they
  this those though three through thus two under use used uses using various very via was were what when where
  whether which while who whose why will with within without work would yet approach approaches method methods
  result results based data model models analysis however here we`.split(/\s+/),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(?:ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokens(p: { title: string; abstract: string }): string[] {
  return normalizeText(`${p.title} ${p.title} ${p.abstract}`)
    .split(/[^\p{L}\p{N}+-]+/u)
    .map((w) => w.replace(/^[-+]+|[-+]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^[\d.+-]+$/.test(w))
    .map(stem);
}

type Vec = Map<string, number>;

function normalize(v: Vec): Vec {
  let n = 0;
  for (const x of v.values()) n += x * x;
  n = Math.sqrt(n) || 1;
  for (const [k, x] of v) v.set(k, x / n);
  return v;
}

function cosine(a: Vec, b: Vec): number {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, x] of small) s += x * (big.get(k) ?? 0);
  return s;
}

export class Profile {
  #idf = new Map<string, number>();
  #maxIdf = 1;
  #like: Vec | null = null;
  #dislike: Vec | null = null;

  constructor(liked: Paper[], disliked: Paper[], corpus: Paper[]) {
    const docs = [...corpus, ...liked, ...disliked];
    const df = new Map<string, number>();
    for (const d of docs) for (const t of new Set(tokens(d))) df.set(t, (df.get(t) ?? 0) + 1);
    const N = docs.length;
    for (const [t, n] of df) this.#idf.set(t, Math.log((N + 1) / (n + 1)) + 1);
    this.#maxIdf = Math.log(N + 1) + 1;
    this.#like = liked.length ? this.#centroid(liked) : null;
    this.#dislike = disliked.length ? this.#centroid(disliked) : null;
  }

  get active() {
    return this.#like !== null;
  }

  vector(p: { title: string; abstract: string }): Vec {
    const tf = new Map<string, number>();
    for (const t of tokens(p)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, n] of tf) v.set(t, (1 + Math.log(n)) * (this.#idf.get(t) ?? this.#maxIdf));
    return normalize(v);
  }

  #centroid(papers: Paper[]): Vec {
    const sum: Vec = new Map();
    for (const p of papers) for (const [k, x] of this.vector(p)) sum.set(k, (sum.get(k) ?? 0) + x);
    return normalize(sum);
  }

  similarity(p: { title: string; abstract: string }): { like: number; dislike: number } {
    const v = this.vector(p);
    return {
      like: this.#like ? cosine(v, this.#like) : 0,
      dislike: this.#dislike ? cosine(v, this.#dislike) : 0,
    };
  }
}

export interface Scored {
  score: number;
  matched: string[];
  /** like − 0.6·dislike cosine, when the user has rated papers */
  sim: number | null;
}

export function scorePaper(p: Paper, ast: QNode | null, profile: Profile | null, nowMs = Date.now()): Scored {
  const doc = makeDoc(p);
  const terms = collectTerms(ast);
  let raw = 0;
  const matched: string[] = [];
  for (const t of terms) {
    const h = termHits(t, doc);
    if (h.title + h.abstract + h.authors > 0) matched.push(t.text + (t.prefix ? "*" : ""));
    raw += 3 * Math.min(h.title, 2) + Math.min(h.abstract, 3) + 2 * Math.min(h.authors, 1);
  }
  // a category-only topic has no keywords; give it a neutral keyword score
  const kw = terms.length ? 1 - Math.exp(-raw / 5) : 0.5;
  const ageDays = Math.max(0, (nowMs - Date.parse(p.updated || p.published)) / 86_400_000);
  const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / 7) : 0.5;
  let sim: number | null = null;
  let s = 0.82 * kw + 0.18 * recency;
  if (profile?.active) {
    const { like, dislike } = profile.similarity(p);
    sim = like - 0.6 * dislike;
    s = 0.6 * kw + 0.12 * recency + 0.28 * Math.min(1, Math.max(0, sim / 0.3));
  }
  return { score: Math.round(100 * s), matched, sim };
}
