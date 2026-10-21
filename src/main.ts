/**
 * 预印本雷达 PreprintRadar — entry point.
 *
 *   PreprintRadar.exe               start (or focus the running instance) and open the window
 *   PreprintRadar.exe --background  start in the tray only (used for autostart)
 *   --port=N --no-tray --no-window  for development and tests
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ID, APP_NAME, ASSET_DIR, DATA_DIR, DEFAULT_PORT, DEFAULT_SETTINGS, VERSION } from "./config.ts";
import * as db from "./db.ts";
import { startExport } from "./exporter.ts";
import { log } from "./log.ts";
import { onRunFinished, type RunSummary } from "./recommend.ts";
import { startScheduler } from "./scheduler.ts";
import { makeHandler } from "./server.ts";
import { autostartEnabled, knownFolders, openAppWindow, showToast } from "./system.ts";
import { useArxivProvider } from "./engine.ts";
import { configureHttp } from "./http.ts";
import { arxivApi } from "./sources/arxiv.ts";
import { plainTitle } from "./text.ts";
import { httpClient, initTls } from "./tls.ts";
import { queueBalloon, startTray, stopTray } from "./tray.ts";

const flags = new Set(Deno.args);
const portArg = Number(Deno.args.find((a) => a.startsWith("--port="))?.slice(7)) || 0;
const INSTANCE = join(DATA_DIR, "instance.json");

async function runningInstance(): Promise<number | null> {
  try {
    const { port } = JSON.parse(Deno.readTextFileSync(INSTANCE));
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).app === APP_ID ? port : null;
  } catch {
    return null;
  }
}

async function initSettings() {
  const stored = db.kvGet<Record<string, unknown> | null>("settings", null);
  if (!stored) {
    const s = { ...DEFAULT_SETTINGS };
    const k = await knownFolders().catch(() => ({} as { documents?: string; downloads?: string }));
    if (k.documents) s.exportDir = join(k.documents, APP_ID);
    if (k.downloads) s.downloadsDir = k.downloads;
    db.saveSettings(s);
  }
  const s = db.getSettings();
  if (s.autostart !== autostartEnabled()) db.saveSettings({ ...s, autostart: autostartEnabled() });
}

/** The tray and toasts run outside this process, so give them real files (a compiled exe embeds its assets). */
function installIcons() {
  const out = { ico: join(DATA_DIR, "icon.ico"), png: join(DATA_DIR, "icon.png") };
  for (const [src, dst] of [["icon.ico", out.ico], ["icon.png", out.png]]) {
    try {
      copyFileSync(join(ASSET_DIR, src), dst);
    } catch (e) {
      log(`cannot install ${src}`, e);
    }
  }
  return out;
}

function afterRun(s: RunSummary, port: number, iconPng: string) {
  if (!s.nNew) return;
  const settings = db.getSettings();
  if (settings.notify && s.trigger !== "manual") {
    const title = `${APP_NAME}：${s.nNew} 篇新推荐`;
    const body = s.top.slice(0, 2).map((p) => "• " + plainTitle(p.title).slice(0, 90)).join("\n");
    showToast(title, body, `http://127.0.0.1:${port}/#/feed`, iconPng).then((ok) => ok || queueBalloon(title, body));
  }
  if (settings.autoExport !== "off") {
    const d = new Date();
    startExport(s.uids, settings.autoExport, `自动推荐 ${d.getMonth() + 1}月${d.getDate()}日`, true);
  }
}

function listen(ctxBase: { iconPng: string; quit: () => void }) {
  const first = portArg || DEFAULT_PORT;
  for (let port = first; port < first + 10; port++) {
    try {
      const server = Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {} }, makeHandler({ ...ctxBase, port }));
      return { server, port };
    } catch (e) {
      if (!(e instanceof Deno.errors.AddrInUse)) throw e;
    }
  }
  throw new Error("找不到可用端口");
}

async function main() {
  Deno.mkdirSync(DATA_DIR, { recursive: true });
  const existing = await runningInstance();
  if (existing) {
    if (!flags.has("--background")) {
      await fetch(`http://127.0.0.1:${existing}/api/window`, { method: "POST", headers: { "X-Radar": "1" } }).catch(() => {});
    }
    return;
  }

  db.openDb();
  db.closeStaleRuns();
  await initTls();
  configureHttp({ client: httpClient(), log });
  useArxivProvider(arxivApi);
  await initSettings();
  const icons = installIcons();

  let shutdown = () => {};
  const { server, port } = listen({ iconPng: icons.png, quit: () => shutdown() });
  shutdown = () => {
    log("quit");
    stopTray();
    try {
      Deno.removeSync(INSTANCE);
    } catch { /* gone */ }
    server.shutdown().finally(() => Deno.exit(0));
    setTimeout(() => Deno.exit(0), 1500);
  };
  Deno.writeTextFileSync(INSTANCE, JSON.stringify({ port, pid: Deno.pid, version: VERSION }));
  log(`${APP_NAME} ${VERSION} on http://127.0.0.1:${port}/ (data: ${DATA_DIR})`);

  onRunFinished((s) => afterRun(s, port, icons.png));
  startScheduler();
  if (!flags.has("--no-tray")) startTray(port, icons.ico);
  if (!flags.has("--background") && !flags.has("--no-window")) {
    openAppWindow(`http://127.0.0.1:${port}/`, db.getSettings().uiBrowser);
  }
}

main().catch((e) => {
  log("fatal", e);
  Deno.exit(1);
});
