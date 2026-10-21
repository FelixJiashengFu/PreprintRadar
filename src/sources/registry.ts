import type { Source } from "../types.ts";

export interface SourceInfo {
  id: Source;
  name: string;
  /** what it covers, for the UI */
  field: string;
  /** new postings per day, measured October 2026 — decides scanning vs. querying */
  perDay: number;
  /** "direct": the app downloads the PDF; "browser": the site only serves real browsers */
  pdf: "direct" | "browser";
  /** selected by default for new topics and searches */
  default: boolean;
  /** badge ink on paper, and on the dark "夜读" background */
  color: string;
  dark: string;
}

export const SOURCES: SourceInfo[] = [
  { id: "arxiv", name: "arXiv", field: "物理、化学物理、材料、计算机、数学", perDay: 900, pdf: "direct", default: true, color: "#93492b", dark: "#d79471" },
  { id: "chemrxiv", name: "ChemRxiv", field: "化学全领域", perDay: 45, pdf: "browser", default: true, color: "#2f5b63", dark: "#7fb3b5" },
  { id: "biorxiv", name: "bioRxiv", field: "生物、生物化学、化学生物学", perDay: 250, pdf: "direct", default: true, color: "#3e6a47", dark: "#8fbf8f" },
  { id: "researchsquare", name: "Research Square", field: "多学科（Springer Nature 在审稿件）", perDay: 410, pdf: "direct", default: true, color: "#34508a", dark: "#8ea6d9" },
  { id: "preprints", name: "Preprints.org", field: "多学科（MDPI）", perDay: 130, pdf: "direct", default: true, color: "#7a5a22", dark: "#d1aa62" },
  { id: "beilstein", name: "Beilstein Archives", field: "有机化学、纳米科学", perDay: 0.3, pdf: "direct", default: true, color: "#9b2c4a", dark: "#e08aa0" },
  { id: "medrxiv", name: "medRxiv", field: "医学、药理", perDay: 60, pdf: "direct", default: false, color: "#6e3f7a", dark: "#c39bd0" },
  { id: "ssrn", name: "SSRN", field: "多学科（Elsevier；以社科为主）", perDay: 950, pdf: "browser", default: false, color: "#5e5a52", dark: "#b3ada2" },
  { id: "eartharxiv", name: "EarthArXiv", field: "地球科学、环境化学", perDay: 7, pdf: "direct", default: false, color: "#5b6b2f", dark: "#b5c47a" },
  { id: "essoar", name: "ESS Open Archive", field: "地球与空间科学（AGU）", perDay: 14, pdf: "browser", default: false, color: "#2f6b8a", dark: "#7fbcd9" },
  { id: "authorea", name: "Authorea", field: "多学科（Wiley）", perDay: 8, pdf: "browser", default: false, color: "#7a4a2e", dark: "#d39a76" },
  { id: "engrxiv", name: "engrXiv", field: "工程", perDay: 4, pdf: "browser", default: false, color: "#85612a", dark: "#d6b071" },
];

export const SOURCE_IDS: Source[] = SOURCES.map((s) => s.id);
export const DEFAULT_SOURCES: Source[] = SOURCES.filter((s) => s.default).map((s) => s.id);
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const sourceInfo = (id: Source) => BY_ID.get(id)!;
export const sourceName = (id: string) => BY_ID.get(id as Source)?.name ?? id;
export const isSource = (s: unknown): s is Source => typeof s === "string" && BY_ID.has(s as Source);
