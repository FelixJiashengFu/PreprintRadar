import type { QNode } from "../query.ts";
import type { Paper } from "../types.ts";

/**
 * How arXiv is reached: the desktop app uses the official API (export.arxiv.org); the web version
 * uses DataCite, because the arXiv API sends no CORS headers and browsers may not call it.
 */
export interface ArxivProvider {
  window(ast: QNode | null, cats: string[], from: Date, to: Date, cap: number): Promise<Paper[]>;
  search(
    ast: QNode,
    opts: { from?: Date; page: number; size: number; sort: "date" | "relevance" },
  ): Promise<{ total: number; papers: Paper[] }>;
}
