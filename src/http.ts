/** Polite fetching, shared by the desktop app (Deno) and the web version (browser). */
import { USER_AGENT } from "./meta.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IN_BROWSER = typeof (globalThis as { document?: unknown }).document !== "undefined";

type Logger = (...parts: unknown[]) => void;
let logger: Logger = () => {};
let client: unknown;

/** Desktop wiring: the app's logger and an HTTP client that trusts the Windows certificate store. */
export function configureHttp(opts: { log?: Logger; client?: unknown }) {
  if (opts.log) logger = opts.log;
  if (opts.client) client = opts.client;
}

/** Serialises requests to one host and keeps a minimum gap between them. */
class Gate {
  #last = 0;
  #chain: Promise<unknown> = Promise.resolve();
  constructor(readonly gapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(async () => {
      const wait = this.#last + this.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        this.#last = Date.now();
      }
    });
    this.#chain = next.catch(() => {});
    return next;
  }
}

// Published etiquette: arXiv API ≤ 1 request / 3 s; Crossref public pool 1 request/s, concurrency 1.
const gates = new Map<string, Gate>([
  ["export.arxiv.org", new Gate(3100)],
  ["api.crossref.org", new Gate(1100)],
  ["api.datacite.org", new Gate(400)],
  ["arxiv.org", new Gate(1000)],
]);

function gateFor(host: string): Gate {
  let g = gates.get(host);
  if (!g) gates.set(host, g = new Gate(300));
  return g;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  accept?: string;
}

/** fetch() with a per-host rate limit, timeout, and retries on network errors, 429 and 5xx. */
export async function politeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 25_000, retries = 2, accept } = opts;
  const host = new URL(url).host;
  const gate = gateFor(host);
  // browsers forbid User-Agent and a custom Accept would force a CORS preflight
  const headers: Record<string, string> = IN_BROWSER
    ? {}
    : { "User-Agent": USER_AGENT, ...(accept ? { Accept: accept } : {}) };
  let lastErr: unknown = new Error("request failed");
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) logger(`retry ${attempt}/${retries} ${host}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
    try {
      const res = await gate.run(() =>
        fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), ...(client ? { client } : {}) } as RequestInit)
      );
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await res.body?.cancel();
        lastErr = new HttpError(res.status, `HTTP ${res.status} from ${host}`);
        if (attempt < retries) await sleep(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await politeFetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
  return text;
}

/** Crossref occasionally answers 200 with an empty body; treat that as transient. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await fetchText(url, opts);
    try {
      if (text.trim()) return JSON.parse(text) as T;
      lastErr = new Error(`empty response from ${new URL(url).host}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(1500 * (attempt + 1));
  }
  throw lastErr;
}
