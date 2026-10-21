import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID } from "./meta.ts";
import { MIN_INTERVAL_MINUTES, type ScheduleSettings } from "./schedule.ts";
import type { ExportMode } from "./types.ts";

export { APP_ID, APP_NAME, USER_AGENT, VERSION } from "./meta.ts";
export { intervalMs, MIN_INTERVAL_MINUTES } from "./schedule.ts";
export const DEFAULT_PORT = 8765;

export const HOME = Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
const LOCAL_APPDATA = Deno.env.get("LOCALAPPDATA") ?? join(HOME, "AppData", "Local");
/** --data=<dir> or PREPRINT_RADAR_HOME keeps data elsewhere (development, tests, a portable install). */
export const DATA_DIR = Deno.args.find((a) => a.startsWith("--data="))?.slice(7) ||
  Deno.env.get("PREPRINT_RADAR_HOME") || join(LOCAL_APPDATA, APP_ID);
export const DB_PATH = join(DATA_DIR, "radar.db");
export const PDF_CACHE = join(DATA_DIR, "pdfs");
export const TMP_DIR = join(DATA_DIR, "tmp");
export const LOG_DIR = join(DATA_DIR, "logs");

/** Folder holding web/ and assets/ — also valid inside a `deno compile` binary (they are --include'd). */
export const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const WEB_DIR = join(APP_ROOT, "web");
export const ASSET_DIR = join(APP_ROOT, "assets");

export interface Settings extends ScheduleSettings {
  /** How far back each automatic run looks for new papers */
  lookbackDays: number;
  maxPerRun: number;
  /** 0–100; papers scoring below are not recommended */
  minScore: number;
  exportDir: string;
  /** Where the browser saves files — scanned for ChemRxiv PDFs the app could not fetch itself */
  downloadsDir: string;
  autoExport: "off" | ExportMode;
  openBrowserForBlocked: boolean;
  notify: boolean;
  autostart: boolean;
  uiBrowser: "edge" | "chrome" | "default";
}

export const DEFAULT_SETTINGS: Settings = {
  scheduleEnabled: true,
  scheduleMode: "interval",
  intervalValue: 12,
  intervalUnit: "hours",
  dailyTime: "08:30",
  lookbackDays: 4,
  maxPerRun: 20,
  minScore: 25,
  exportDir: join(HOME, "Documents", APP_ID),
  downloadsDir: join(HOME, "Downloads"),
  autoExport: "off",
  openBrowserForBlocked: true,
  notify: true,
  autostart: false,
  uiBrowser: "edge",
};

/** Merge untrusted input (from the UI or the database) onto `base`, keeping only valid values. */
export function sanitizeSettings(input: Record<string, unknown>, base: Settings = DEFAULT_SETTINGS): Settings {
  const s: Settings = { ...base };
  const bool = <K extends keyof Settings>(k: K) => {
    if (typeof input[k] === "boolean") (s[k] as boolean) = input[k] as boolean;
  };
  const int = <K extends keyof Settings>(k: K, min: number, max: number) => {
    const v = Number(input[k]);
    if (input[k] !== undefined && input[k] !== "" && Number.isFinite(v)) {
      (s[k] as number) = Math.min(max, Math.max(min, Math.round(v)));
    }
  };
  const oneOf = <K extends keyof Settings>(k: K, allowed: readonly string[]) => {
    if (typeof input[k] === "string" && allowed.includes(input[k] as string)) (s[k] as string) = input[k] as string;
  };
  const path = <K extends keyof Settings>(k: K) => {
    const v = input[k];
    if (typeof v === "string" && v.trim() && isAbsolute(v.trim())) (s[k] as string) = v.trim();
  };

  bool("scheduleEnabled");
  oneOf("scheduleMode", ["interval", "daily"]);
  int("intervalValue", 1, 999);
  oneOf("intervalUnit", ["minutes", "hours", "days"]);
  if (typeof input.dailyTime === "string") {
    const m = input.dailyTime.match(/^(\d{1,2}):(\d{2})$/);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) s.dailyTime = `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  int("lookbackDays", 1, 30);
  int("maxPerRun", 1, 200);
  int("minScore", 0, 100);
  path("exportDir");
  path("downloadsDir");
  oneOf("autoExport", ["off", "merged", "separate", "digest"]);
  bool("openBrowserForBlocked");
  bool("notify");
  bool("autostart");
  oneOf("uiBrowser", ["edge", "chrome", "default"]);
  if (s.intervalUnit === "minutes" && s.intervalValue < MIN_INTERVAL_MINUTES) s.intervalValue = MIN_INTERVAL_MINUTES;
  return s;
}
