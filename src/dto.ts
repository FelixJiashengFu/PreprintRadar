/** Paper → what the UI renders. Shared by the desktop server and the web version. */
import { highlighter, texToHtml } from "./render.ts";
import { plainTitle } from "./text.ts";
import type { Paper } from "./types.ts";

export interface Mark {
  rating: number;
  starred: boolean;
}

export interface RecInfo {
  runId: number;
  topicIds: number[];
  score: number;
  matched: string[];
  read: boolean;
  createdAt: string;
}

export interface Extra {
  score?: number;
  matched?: string[];
  topicIds?: number[];
}

export function paperDto(p: Paper, extra: Extra, mark: Mark | undefined, rec: RecInfo | undefined, hasPdf: boolean) {
  const matched = extra.matched ?? rec?.matched ?? [];
  const re = highlighter(matched.map((t) => ({ text: t.replace(/\*$/, ""), prefix: t.endsWith("*") })));
  return {
    uid: p.uid,
    source: p.source,
    extId: p.extId,
    version: p.version,
    title: plainTitle(p.title),
    titleHtml: texToHtml(p.title, re),
    authors: p.authors,
    abstractHtml: texToHtml(p.abstract, re, true),
    published: p.published,
    updated: p.updated,
    categories: p.categories,
    doi: p.doi,
    url: p.url,
    pdfUrl: p.pdfUrl,
    comment: p.comment,
    journalRef: p.journalRef,
    score: extra.score ?? rec?.score ?? null,
    matched,
    topicIds: extra.topicIds ?? rec?.topicIds ?? [],
    starred: mark?.starred ?? false,
    rating: mark?.rating ?? 0,
    isRec: !!rec,
    read: rec ? rec.read : true,
    hasPdf,
  };
}
