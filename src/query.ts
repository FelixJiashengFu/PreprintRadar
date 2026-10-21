/**
 * A small boolean query language shared by search and interest topics.
 *
 *   machine learning catalys*          implicit AND, * = prefix match
 *   "C-H activation", photoredox        comma / newline / OR / | = OR
 *   (perovskite OR MOF) -review         - or NOT = exclude
 *   ti:"single-atom" au:Kulik           fields: ti / abs / au (default: title + abstract)
 *
 * The same tree is evaluated locally on every candidate (the source of truth), and translated
 * into an arXiv search_query to fetch a superset of candidates.
 */

export type Field = "all" | "ti" | "abs" | "au";
export interface TermNode {
  t: "term";
  text: string;
  phrase: boolean;
  field: Field;
  prefix: boolean;
}
export type QNode = TermNode | { t: "and"; kids: QNode[] } | { t: "or"; kids: QNode[] } | { t: "not"; kid: QNode };

export class QueryError extends Error {}

type Tok =
  | { k: "lp" }
  | { k: "rp" }
  | { k: "and" }
  | { k: "or" }
  | { k: "not" }
  | { k: "field"; field: Field }
  | { k: "term"; text: string; phrase: boolean; prefix: boolean };

const FIELDS: Record<string, Field> = {
  ti: "ti",
  title: "ti",
  abs: "abs",
  abstract: "abs",
  au: "au",
  author: "au",
  all: "all",
};
const QUOTES = new Set(['"', "“", "”"]);
const BREAK = /[\s(),;|&"“”]/;

function tokenize(src: string): Tok[] {
  const s = src.normalize("NFKC");
  const toks: Tok[] = [];
  const pushOr = () => {
    if (toks.length && toks[toks.length - 1].k !== "or") toks.push({ k: "or" });
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\n" || c === "," || c === ";" || c === "|") {
      pushOr();
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "(") {
      toks.push({ k: "lp" });
      i++;
    } else if (c === ")") {
      toks.push({ k: "rp" });
      i++;
    } else if (c === "&") {
      toks.push({ k: "and" });
      i++;
    } else if (QUOTES.has(c)) {
      let j = i + 1;
      while (j < s.length && !QUOTES.has(s[j])) j++;
      const text = s.slice(i + 1, j).trim().replace(/\s+/g, " ");
      i = j + 1;
      const prefix = s[i] === "*";
      if (prefix) i++;
      if (text) toks.push({ k: "term", text: text.replace(/\*$/, ""), phrase: true, prefix: prefix || text.endsWith("*") });
    } else if ((c === "-" || c === "!") && i + 1 < s.length && !BREAK.test(s[i + 1])) {
      toks.push({ k: "not" });
      i++;
    } else {
      let j = i;
      while (j < s.length && !BREAK.test(s[j])) j++;
      const word = s.slice(i, j);
      i = j;
      if (word === "AND") toks.push({ k: "and" });
      else if (word === "OR") toks.push({ k: "or" });
      else if (word === "NOT") toks.push({ k: "not" });
      else {
        const m = word.match(/^([a-z]+):(.*)$/i);
        if (m && FIELDS[m[1].toLowerCase()]) {
          toks.push({ k: "field", field: FIELDS[m[1].toLowerCase()] });
          if (m[2]) toks.push({ k: "term", text: m[2].replace(/\*$/, ""), phrase: false, prefix: m[2].endsWith("*") });
        } else {
          const text = word.replace(/\*+$/, "");
          if (text) toks.push({ k: "term", text, phrase: false, prefix: word.endsWith("*") });
        }
      }
    }
  }
  return toks;
}

function flatten(kind: "and" | "or", kids: QNode[]): QNode[] {
  return kids.flatMap((k) => (k.t === kind ? k.kids : [k]));
}

export function withField(node: QNode, field: Field): QNode {
  switch (node.t) {
    case "term":
      return node.field === "all" ? { ...node, field } : node;
    case "not":
      return { t: "not", kid: withField(node.kid, field) };
    default:
      return { t: node.t, kids: node.kids.map((k) => withField(k, field)) };
  }
}

/** Parse a query; returns null for an empty query (matches everything). Throws QueryError. */
export function parseQuery(src: string): QNode | null {
  const toks = tokenize(src ?? "");
  let pos = 0;

  function parseOr(): QNode | null {
    const kids: QNode[] = [];
    while (pos < toks.length) {
      const n = parseAnd();
      if (n) kids.push(n);
      if (toks[pos]?.k === "or") {
        pos++;
        continue;
      }
      break;
    }
    if (!kids.length) return null;
    return kids.length === 1 ? kids[0] : { t: "or", kids: flatten("or", kids) };
  }

  function parseAnd(): QNode | null {
    const kids: QNode[] = [];
    while (pos < toks.length) {
      const tk = toks[pos];
      if (tk.k === "or" || tk.k === "rp") break;
      if (tk.k === "and") {
        pos++;
        continue;
      }
      const n = parseUnary();
      if (n) kids.push(n);
    }
    if (!kids.length) return null;
    return kids.length === 1 ? kids[0] : { t: "and", kids: flatten("and", kids) };
  }

  function parseUnary(): QNode | null {
    if (toks[pos]?.k === "not") {
      pos++;
      const kid = parseUnary();
      return kid ? { t: "not", kid } : null;
    }
    return parsePrimary();
  }

  function parsePrimary(): QNode | null {
    const tk = toks[pos++];
    if (!tk) return null;
    switch (tk.k) {
      case "lp": {
        const n = parseOr();
        if (toks[pos]?.k !== "rp") throw new QueryError("括号不匹配：缺少右括号 )");
        pos++;
        return n;
      }
      case "field": {
        const n = parseUnary();
        return n ? withField(n, tk.field) : null;
      }
      case "term":
        return { t: "term", text: tk.text, phrase: tk.phrase, field: "all", prefix: tk.prefix };
      default:
        return null;
    }
  }

  const root = parseOr();
  if (pos < toks.length) throw new QueryError(toks[pos].k === "rp" ? "括号不匹配：多了右括号 )" : "无法解析这个表达式");
  return root;
}

// ---------------------------------------------------------------- text normalisation

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ",
  Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

/** Remove TeX markup for matching: "$\mathrm{CO_2}$" → "CO2", "$\alpha$-helix" → "α-helix". */
export function stripTex(s: string): string {
  if (!/[$\\]/.test(s)) return s;
  return s
    .replace(/\\(?:mathrm|mathbf|mathit|mathsf|mathcal|mathbb|text|textrm|textit|textbf|operatorname|rm|bf|it)\b\s*/g, "")
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => GREEK[name] ?? name)
    .replace(/[${}_^~]/g, "");
}

const DASHES = /[‐-―−﹘﹣－]/g;

export function normalizeText(s: string): string {
  return stripTex(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(DASHES, "-")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = "[\\p{L}\\p{N}]";

/** "machine learning" also matches "machine-learning"; plurals match; "catal*" is a prefix. */
export function termPattern(text: string, prefix: boolean): string | null {
  const norm = normalizeText(text).trim();
  const words = norm.split(/[\s-]+/).filter(Boolean).map(escapeRe);
  if (!words.length) return null;
  const lead = /^[\p{L}\p{N}]/u.test(norm) ? `(?<!${WORD})` : "";
  const tail = prefix ? `${WORD}*` : "(?:s|es|'s)?";
  const trail = prefix || /[\p{L}\p{N}]$/u.test(norm) ? `(?!${WORD})` : "";
  return lead + words.join("[\\s\\-]*") + tail + trail;
}

/** The same idea on raw display text (case and dash variants handled by the pattern, use with "giu"). */
export function highlightPattern(text: string, prefix: boolean): string | null {
  const words = normalizeText(text).trim().split(/[\s-]+/).filter(Boolean).map(escapeRe);
  if (!words.length) return null;
  const tail = prefix ? `${WORD}*` : "(?:s|es|'s)?";
  return `(?<!${WORD})` + words.join("[\\s\\-\\u2010-\\u2015\\u2212]*") + tail + `(?!${WORD})`;
}

const reCache = new WeakMap<TermNode, RegExp>();
function termRe(t: TermNode): RegExp {
  let re = reCache.get(t);
  if (!re) {
    const p = termPattern(t.text, t.prefix);
    re = p ? new RegExp(p, "gu") : /(?!)/gu;
    reCache.set(t, re);
  }
  return re;
}

export interface Doc {
  title: string;
  abstract: string;
  authors: string;
}

export function makeDoc(p: { title: string; abstract: string; authors: string[] }): Doc {
  return { title: normalizeText(p.title), abstract: normalizeText(p.abstract), authors: normalizeText(p.authors.join("; ")) };
}

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

export function termHits(t: TermNode, d: Doc): { title: number; abstract: number; authors: number } {
  const re = termRe(t);
  return {
    title: t.field === "all" || t.field === "ti" ? count(re, d.title) : 0,
    abstract: t.field === "all" || t.field === "abs" ? count(re, d.abstract) : 0,
    authors: t.field === "au" ? count(re, d.authors) : 0,
  };
}

export function evaluate(node: QNode | null, d: Doc): boolean {
  if (!node) return true;
  switch (node.t) {
    case "term": {
      const h = termHits(node, d);
      return h.title + h.abstract + h.authors > 0;
    }
    case "and":
      return node.kids.every((k) => evaluate(k, d));
    case "or":
      return node.kids.some((k) => evaluate(k, d));
    case "not":
      return !evaluate(node.kid, d);
  }
}

/** Positive (non-excluded) terms, deduplicated. */
export function collectTerms(node: QNode | null): TermNode[] {
  const out = new Map<string, TermNode>();
  const walk = (n: QNode, negated: boolean) => {
    if (n.t === "term") {
      if (!negated) out.set(`${n.field}|${n.prefix}|${normalizeText(n.text)}`, n);
    } else if (n.t === "not") walk(n.kid, !negated);
    else n.kids.forEach((k) => walk(k, negated));
  };
  if (node) walk(node, false);
  return [...out.values()];
}

// ---------------------------------------------------------------- translations

const isPlainWord = (s: string) => /^[\p{L}\p{N}]+$/u.test(s);

function termToArxiv(t: TermNode): string {
  const f = t.field;
  const text = t.text.replace(/["“”]/g, "").trim();
  // arXiv stems terms itself ("catalyst" = "catalysts"), so plain words and phrases go through as-is
  if (isPlainWord(text)) return t.prefix ? `${f}:${text}*` : `${f}:${text}`;
  return `${f}:"${text}"`;
}

/** True when `s` is one parenthesised group — "(a) AND (b)" starts and ends with a bracket but is not. */
export function isWrapped(s: string): boolean {
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")" && --depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

export const wrapBool = (s: string) => (/\s(?:AND|OR|ANDNOT|NOT)\s/.test(s) && !isWrapped(s) ? `(${s})` : s);
const wrap = wrapBool;
const hasNot = (n: QNode): boolean => n.t === "not" || (n.t !== "term" && n.kids.some(hasNot));

/**
 * arXiv search_query for a superset of the matches (exclusions only where they are safe).
 * null means "no keyword constraint".
 */
export function toArxiv(node: QNode | null): string | null {
  if (!node) return null;
  switch (node.t) {
    case "term":
      return termToArxiv(node);
    case "not":
      return null;
    case "or": {
      const parts = node.kids.map(toArxiv);
      if (parts.some((p) => p === null)) return null;
      return parts.map((p) => wrap(p!)).join(" OR ");
    }
    case "and": {
      const pos = node.kids.filter((k) => k.t !== "not").map(toArxiv).filter((p): p is string => p !== null);
      if (!pos.length) return null;
      let s = pos.length === 1 ? pos[0] : pos.map(wrap).join(" AND ");
      for (const k of node.kids) {
        if (k.t === "not" && !hasNot(k.kid)) {
          const neg = toArxiv(k.kid);
          if (neg) s = `${wrap(s)} ANDNOT ${wrap(neg)}`;
        }
      }
      return s;
    }
  }
}

/**
 * Free-text query for Crossref's relevance search. A bare stem like "catalys" matches no word there,
 * so prefix terms are left out when whole words remain (the local filter still enforces them).
 */
export function toCrossref(node: QNode | null): string {
  const terms = collectTerms(node);
  const whole = terms.filter((t) => !t.prefix);
  return (whole.length ? whole : terms).map((t) => t.text).join(" ");
}

const FIELD_LABEL: Record<Field, string> = { all: "", ti: "标题:", abs: "摘要:", au: "作者:" };

/** Human-readable rendering, shown in the UI so users see how their query was understood. */
export function describe(node: QNode | null, top = true): string {
  if (!node) return "（不限关键词）";
  switch (node.t) {
    case "term": {
      const text = node.text + (node.prefix ? "*" : "");
      return FIELD_LABEL[node.field] + (node.phrase || /\s/.test(node.text) ? `"${text}"` : text);
    }
    case "not":
      return "非 " + describe(node.kid, false);
    case "and": {
      const s = node.kids.map((k) => describe(k, false)).join(" 且 ");
      return top ? s : `(${s})`;
    }
    case "or": {
      const s = node.kids.map((k) => describe(k, false)).join(" 或 ");
      return top ? s : `(${s})`;
    }
  }
}
