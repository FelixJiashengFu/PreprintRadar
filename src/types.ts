export type Source =
  | "arxiv"
  | "chemrxiv"
  | "biorxiv"
  | "medrxiv"
  | "researchsquare"
  | "preprints"
  | "beilstein"
  | "ssrn"
  | "eartharxiv"
  | "essoar"
  | "authorea"
  | "engrxiv";

export interface Paper {
  /** "arxiv:2610.28529" or "chemrxiv:15010774" — version-independent */
  uid: string;
  source: Source;
  extId: string;
  version: number;
  title: string;
  authors: string[];
  abstract: string;
  /** ISO time. arXiv: first version; ChemRxiv: when this version was posted */
  published: string;
  /** ISO time of the version we hold */
  updated: string;
  categories: string[];
  doi?: string;
  url: string;
  pdfUrl: string;
  comment?: string;
  journalRef?: string;
  license?: string;
}

export interface Topic {
  id: number;
  name: string;
  query: string;
  sources: Source[];
  arxivCats: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExportMode = "merged" | "separate" | "digest";
