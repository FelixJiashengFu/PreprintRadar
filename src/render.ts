import { highlightPattern } from "./query.ts";

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ",
  Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", cdotp: "·", pm: "±", mp: "∓", approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", ll: "≪", gg: "≫", lesssim: "≲", gtrsim: "≳",
  rightarrow: "→", to: "→", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftrightarrow: "⇔",
  rightleftharpoons: "⇌", longrightarrow: "⟶", uparrow: "↑", downarrow: "↓", infty: "∞", partial: "∂",
  nabla: "∇", circ: "°", degree: "°", textdegree: "°", AA: "Å", angstrom: "Å", hbar: "ℏ", ell: "ℓ", langle: "⟨",
  rangle: "⟩", sqrt: "√", sum: "∑", prod: "∏", int: "∫", prime: "′", ldots: "…", cdots: "⋯", dots: "…",
  propto: "∝", perp: "⊥", parallel: "∥", in: "∈", star: "⋆", ast: "∗", dagger: "†", ddagger: "‡",
  bullet: "•", deg: "°", ohm: "Ω", textmu: "µ", "%": "%", "&": "&", _: "_", "#": "#", $: "$", "{": "{", "}": "}",
  ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: " ", qquad: "  ", "\\": " ",
};
const SKIP = new Set([
  "mathrm", "mathbf", "mathit", "mathsf", "mathcal", "mathbb", "mathscr", "text", "textrm", "textit", "textbf",
  "textsf", "operatorname", "rm", "bf", "it", "left", "right", "big", "Big", "bigl", "bigr", "Bigl", "Bigr",
  "displaystyle", "textstyle", "boldsymbol", "mathring", "hat", "bar", "tilde", "vec", "dot", "ddot", "overline",
  "underline", "ce",
]);

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return s.length;
}

/** Inline TeX → HTML good enough for titles/abstracts: Greek, symbols, sub/superscripts. */
function mathToHtml(m: string): string {
  let out = "";
  let i = 0;
  while (i < m.length) {
    const c = m[i];
    if (c === "\\") {
      const name = m.slice(i + 1).match(/^([a-zA-Z]+|.)/)?.[1] ?? "";
      i += 1 + name.length;
      if (!SKIP.has(name)) out += escapeHtml(SYMBOLS[name] ?? name);
    } else if (c === "_" || c === "^") {
      i++;
      let arg = "";
      if (m[i] === "{") {
        const end = matchBrace(m, i);
        arg = m.slice(i + 1, end);
        i = end + 1;
      } else if (m[i] === "\\") {
        const name = m.slice(i + 1).match(/^([a-zA-Z]+|.)/)?.[1] ?? "";
        arg = "\\" + name;
        i += 1 + name.length;
      } else {
        arg = m[i] ?? "";
        i++;
      }
      const tag = c === "_" ? "sub" : "sup";
      out += `<${tag}>${mathToHtml(arg)}</${tag}>`;
    } else if (c === "{" || c === "}") {
      i++;
    } else if (c === "~") {
      out += " ";
      i++;
    } else {
      out += escapeHtml(c);
      i++;
    }
  }
  return out;
}

function highlightPlain(text: string, re: RegExp | null): string {
  if (!re) return escapeHtml(text);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    out += escapeHtml(text.slice(last, m.index)) + "<mark>" + escapeHtml(m[0]) + "</mark>";
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

export interface HighlightTerm {
  text: string;
  prefix: boolean;
}

export function highlighter(terms: HighlightTerm[]): RegExp | null {
  const parts = terms.map((t) => highlightPattern(t.text, t.prefix)).filter((p): p is string => !!p);
  return parts.length ? new RegExp(parts.map((p) => `(?:${p})`).join("|"), "giu") : null;
}

/** Text with $…$ math → safe HTML. Paragraph breaks ("\n\n") become <p> when `paragraphs` is set. */
export function texToHtml(s: string, re: RegExp | null = null, paragraphs = false): string {
  const render = (chunk: string) => {
    let out = "";
    const parts = chunk.split(/(\$[^$]*\$)/g);
    for (const part of parts) {
      if (part.length > 1 && part.startsWith("$") && part.endsWith("$")) out += mathToHtml(part.slice(1, -1));
      else out += highlightPlain(part, re);
    }
    return out;
  };
  if (!paragraphs) return render(s.replace(/\s*\n\s*/g, " "));
  return s
    .split(/\n\s*\n/)
    .map((p) => `<p>${render(p.trim())}</p>`)
    .join("");
}
