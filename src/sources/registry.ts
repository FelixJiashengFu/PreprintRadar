import type { Source } from "../types.ts";

/** Discipline groups for the source picker, in display order. */
export const SOURCE_GROUPS = [
  ["multi", "综合"],
  ["science", "理工"],
  ["life", "生命与医学"],
  ["earth", "地球与环境"],
  ["social", "社会科学"],
  ["humanities", "人文与传播"],
] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number][0];

export interface SourceInfo {
  id: Source;
  name: string;
  /** what it covers, for the UI */
  field: string;
  /** where the picker lists it */
  group: SourceGroup;
  /** new postings per day, measured October–November 2026 — decides scanning vs. querying */
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
  { id: "arxiv", name: "arXiv", field: "物理、数学、计算机、定量生物、金融、统计、电子工程、经济", group: "science", perDay: 900, pdf: "direct", default: true, color: "#93492b", dark: "#d79471" },
  { id: "chemrxiv", name: "ChemRxiv", field: "化学全领域", group: "science", perDay: 45, pdf: "browser", default: true, color: "#2f5b63", dark: "#7fb3b5" },
  { id: "biorxiv", name: "bioRxiv", field: "生物、生物化学、化学生物学", group: "life", perDay: 250, pdf: "direct", default: true, color: "#3e6a47", dark: "#8fbf8f" },
  { id: "researchsquare", name: "Research Square", field: "多学科（Springer Nature 在审稿件）", group: "multi", perDay: 410, pdf: "direct", default: true, color: "#34508a", dark: "#8ea6d9" },
  { id: "preprints", name: "Preprints.org", field: "多学科（MDPI），含艺术与人文", group: "multi", perDay: 130, pdf: "direct", default: true, color: "#7a5a22", dark: "#d1aa62" },
  { id: "beilstein", name: "Beilstein Archives", field: "有机化学、纳米科学", group: "science", perDay: 0.3, pdf: "direct", default: true, color: "#9b2c4a", dark: "#e08aa0" },
  { id: "medrxiv", name: "medRxiv", field: "医学、药理", group: "life", perDay: 60, pdf: "direct", default: false, color: "#6e3f7a", dark: "#c39bd0" },
  { id: "ssrn", name: "SSRN", field: "社会科学为主（Elsevier），含人文、法学、经济、管理", group: "social", perDay: 950, pdf: "browser", default: false, color: "#5e5a52", dark: "#b3ada2" },
  { id: "eartharxiv", name: "EarthArXiv", field: "地球科学、环境化学", group: "earth", perDay: 7, pdf: "direct", default: false, color: "#5b6b2f", dark: "#b5c47a" },
  { id: "essoar", name: "ESS Open Archive", field: "地球与空间科学（AGU）", group: "earth", perDay: 14, pdf: "browser", default: false, color: "#2f6b8a", dark: "#7fbcd9" },
  { id: "authorea", name: "Authorea", field: "多学科（Wiley）", group: "multi", perDay: 8, pdf: "browser", default: false, color: "#7a4a2e", dark: "#d39a76" },
  { id: "osf", name: "OSF Preprints", field: "多学科（开放科学中心），含法学（LawArXiv）与人文", group: "multi", perDay: 7, pdf: "browser", default: false, color: "#3d5a6c", dark: "#8fb0c4" },
  { id: "qeios", name: "Qeios", field: "多学科，含人文与社科，公开同行评议", group: "multi", perDay: 1.7, pdf: "browser", default: false, color: "#6a4a7a", dark: "#b99ccb" },
  { id: "scielo", name: "SciELO Preprints", field: "多学科（拉美与伊比利亚），含人文", group: "multi", perDay: 4, pdf: "browser", default: false, color: "#3f6b5c", dark: "#8cc2ad" },
  { id: "engage", name: "Cambridge Open Engage", field: "多学科（剑桥大学出版社），含 APSA 政治学预印本", group: "multi", perDay: 3, pdf: "browser", default: false, color: "#8a3a3a", dark: "#d98c8c" },
  { id: "ecsarxiv", name: "ECSarXiv", field: "电化学、固态科学（美国电化学学会）", group: "science", perDay: 0.2, pdf: "browser", default: false, color: "#4a5f2a", dark: "#a8bf78" },
  { id: "jmir", name: "JMIR Preprints", field: "数字医疗、医学信息学", group: "life", perDay: 16, pdf: "browser", default: false, color: "#2f4f7a", dark: "#86a5d4" },
  { id: "ecoevorxiv", name: "EcoEvoRxiv", field: "生态学、演化生物学、环境科学", group: "life", perDay: 4.6, pdf: "browser", default: false, color: "#4f6b2f", dark: "#a3c47f" },
  { id: "agrirxiv", name: "agriRxiv", field: "农业、食品与兽医（CABI）", group: "life", perDay: 0.6, pdf: "browser", default: false, color: "#7a6a2a", dark: "#cdbb72" },
  { id: "sportrxiv", name: "SportRxiv", field: "体育与运动科学", group: "life", perDay: 1, pdf: "browser", default: false, color: "#2f6b6b", dark: "#7fc0c0" },
  { id: "paleorxiv", name: "PaleorXiv", field: "古生物学", group: "earth", perDay: 0.2, pdf: "browser", default: false, color: "#6b5b45", dark: "#bfae93" },
  { id: "socarxiv", name: "SocArXiv", field: "社会学、政治学、经济、法学等社会科学", group: "social", perDay: 27, pdf: "browser", default: false, color: "#5a3f6b", dark: "#b195c4" },
  { id: "psyarxiv", name: "PsyArXiv", field: "心理学、认知科学", group: "social", perDay: 60, pdf: "browser", default: false, color: "#7a3f5a", dark: "#d197b1" },
  { id: "edarxiv", name: "EdArXiv", field: "教育学", group: "social", perDay: 6, pdf: "browser", default: false, color: "#3f5a7a", dark: "#95b0d1" },
  { id: "metaarxiv", name: "MetaArXiv", field: "元科学、科研方法与可重复性", group: "social", perDay: 1.6, pdf: "browser", default: false, color: "#5a5a3f", dark: "#b8b88f" },
  { id: "kcworks", name: "Knowledge Commons", field: "人文学科：文学、历史、哲学、语言、艺术、宗教（MLA 的开放仓库）", group: "humanities", perDay: 50, pdf: "browser", default: false, color: "#8a4a2a", dark: "#dc9a78" },
  { id: "mediarxiv", name: "MediArXiv", field: "传媒、传播与电影研究", group: "humanities", perDay: 1.2, pdf: "browser", default: false, color: "#6b3a4a", dark: "#c98fa2" },
  { id: "engrxiv", name: "engrXiv", field: "工程", group: "science", perDay: 4, pdf: "browser", default: false, color: "#85612a", dark: "#d6b071" },
];

export const SOURCE_IDS: Source[] = SOURCES.map((s) => s.id);
export const DEFAULT_SOURCES: Source[] = SOURCES.filter((s) => s.default).map((s) => s.id);
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const sourceInfo = (id: Source) => BY_ID.get(id)!;
export const sourceName = (id: string) => BY_ID.get(id as Source)?.name ?? id;
export const isSource = (s: unknown): s is Source => typeof s === "string" && BY_ID.has(s as Source);
