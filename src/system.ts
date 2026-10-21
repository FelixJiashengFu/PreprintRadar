/** Windows integration: processes, PowerShell, browser windows, toasts, folders, autostart. */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_NAME, TMP_DIR } from "./config.ts";
import { log } from "./log.ts";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a console program without flashing a window; collects UTF-8 output. */
export function runProcess(cmd: string, args: string[], timeoutMs = 60_000): Promise<ProcResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch { /* already gone */ }
    }, timeoutMs);
    const done = (code: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8") + extra,
      });
    };
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e: Error) => done(-1, String(e)));
    child.on("close", (code: number | null) => done(code));
  });
}

/** Quote for a single-quoted PowerShell string. */
export const psq = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

/** -EncodedCommand payload (UTF-16LE), so non-ASCII text survives Windows PowerShell 5.1. */
export function encodePs(script: string, strict = true): string {
  const prelude = (strict ? "$ErrorActionPreference = 'Stop'\n" : "") +
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n";
  return Buffer.from(prelude + script, "utf16le").toString("base64");
}

export function powershell(script: string, timeoutMs = 60_000): Promise<ProcResult> {
  return runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePs(script)],
    timeoutMs,
  );
}

function launch(cmd: string, args: string[], raw = false) {
  const child = new Deno.Command(cmd, { args, windowsRawArguments: raw, stdin: "null", stdout: "null", stderr: "null" })
    .spawn();
  child.unref();
  child.status.catch(() => {});
}

export function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error("只能打开 http(s) 链接");
  launch("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
}

export function openPath(path: string) {
  launch("explorer.exe", [path]);
}

export function revealPath(path: string) {
  launch("explorer.exe", [`/select,"${path.replace(/"/g, "")}"`], true);
}

export function findBrowser(kind: "edge" | "chrome"): string | null {
  const pf = Deno.env.get("ProgramFiles") ?? "C:\\Program Files";
  const pf86 = Deno.env.get("ProgramFiles(x86)") ?? "C:\\Program Files (x86)";
  const local = Deno.env.get("LOCALAPPDATA") ?? "";
  const candidates = kind === "edge"
    ? [join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), join(pf, "Microsoft", "Edge", "Application", "msedge.exe")]
    : [
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      local && join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  return candidates.find((c) => c && existsSync(c)) || null;
}

/** The main window: an app-mode browser window (no tabs or address bar). */
export function openAppWindow(url: string, pref: "edge" | "chrome" | "default") {
  const exe = pref === "default" ? null : findBrowser(pref) ?? findBrowser(pref === "edge" ? "chrome" : "edge");
  if (!exe) return openUrl(url);
  launch(exe, [`--app=${url}`, "--window-size=1380,920"]);
}

let printChain: Promise<unknown> = Promise.resolve();

/** HTML file → PDF with headless Edge (or Chrome). One print at a time: they share a profile dir. */
export function htmlToPdf(htmlPath: string, pdfPath: string): Promise<boolean> {
  const task = printChain.then(async () => {
    const exe = findBrowser("edge") ?? findBrowser("chrome");
    if (!exe) return false;
    try {
      Deno.removeSync(pdfPath);
    } catch { /* not there */ }
    const r = await runProcess(exe, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--no-pdf-header-footer",
      `--user-data-dir=${join(TMP_DIR, "print-profile")}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ], 120_000);
    const ok = existsSync(pdfPath) && statSync(pdfPath).size > 0;
    if (!ok) log("htmlToPdf failed", r.code, r.stderr.slice(-400));
    return ok;
  });
  printChain = task.catch(() => {});
  return task;
}

export async function knownFolders(): Promise<{ documents?: string; downloads?: string }> {
  const r = await powershell(
    "[Environment]::GetFolderPath('MyDocuments'); (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path",
    20_000,
  );
  const [documents, downloads] = r.stdout.split(/\r?\n/).map((s) => s.trim());
  return { documents: documents || undefined, downloads: downloads || undefined };
}

export async function pickFolder(initial: string, title: string): Promise<string | null> {
  const r = await powershell(
    `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Width = 1; Height = 1; StartPosition = 'CenterScreen' }
$owner.Show(); $owner.Activate()
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = ${psq(title)}
$dlg.ShowNewFolderButton = $true
if (Test-Path -LiteralPath ${psq(initial)}) { $dlg.SelectedPath = ${psq(initial)} }
if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { 'PATH:' + $dlg.SelectedPath }
$owner.Close()`,
    10 * 60_000,
  );
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("PATH:"));
  return line ? line.slice(5).trim() : null;
}

// ---------------------------------------------------------------- toast notifications

const AUMID = "PreprintRadar.App";
const POWERSHELL_AUMID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
let aumid: Promise<string> | null = null;

/** Register a per-user AppUserModelID so toasts show "预印本雷达" and our icon. */
function registerAumid(iconPng: string): Promise<string> {
  return powershell(`$k = 'HKCU:\\Software\\Classes\\AppUserModelId\\${AUMID}'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name DisplayName -Value ${psq(APP_NAME)} -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name IconUri -Value ${psq(iconPng)} -PropertyType String -Force | Out-Null
'ok'`, 20_000).then((r) => (r.code === 0 && r.stdout.includes("ok") ? AUMID : POWERSHELL_AUMID));
}

const xmlEsc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Show a toast; true once Windows has it in the notification centre (checked, since Show() never complains). */
export async function showToast(title: string, body: string, url: string, iconPng: string): Promise<boolean> {
  aumid ??= registerAumid(iconPng);
  const xml = `<toast activationType="protocol" launch="${xmlEsc(url)}" duration="long"><visual><binding template="ToastGeneric">` +
    `<text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual>` +
    `<actions><action content="查看推荐" activationType="protocol" arguments="${xmlEsc(url)}"/></actions></toast>`;
  const show = async (appId: string) => {
    const tag = `radar-${Date.now()}`;
    const r = await powershell(
      `$ProgressPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(${psq(xml)})
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
$toast.Tag = ${psq(tag)}
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psq(appId)}).Show($toast)
Start-Sleep -Milliseconds 500
'delivered:' + @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory(${psq(appId)}) | Where-Object { $_.Tag -eq ${psq(tag)} }).Count`,
      30_000,
    );
    if (r.code !== 0) log("toast failed", appId, r.stderr.slice(-300));
    return r.code === 0 && /delivered:[1-9]/.test(r.stdout);
  };
  const appId = await aumid;
  if (await show(appId)) return true;
  if (appId === POWERSHELL_AUMID) return false;
  // our own identity was not accepted (e.g. a locked-down registry): use PowerShell's from now on
  log("toast: own AppUserModelID not accepted, using PowerShell's");
  aumid = Promise.resolve(POWERSHELL_AUMID);
  return show(POWERSHELL_AUMID);
}

// ---------------------------------------------------------------- autostart

function startupShortcut(): string {
  const appData = Deno.env.get("APPDATA") ?? join(Deno.env.get("USERPROFILE") ?? "", "AppData", "Roaming");
  return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "PreprintRadar.lnk");
}

/** Only the packaged .exe can autostart (a `deno run` dev setup would open a console at login). */
export const isCompiled = () => /preprintradar[^\\/]*\.exe$/i.test(Deno.execPath());

export async function setAutostart(enabled: boolean): Promise<boolean> {
  const lnk = startupShortcut();
  if (!enabled) {
    try {
      Deno.removeSync(lnk);
    } catch { /* not there */ }
    return true;
  }
  if (!isCompiled()) return false;
  const exe = Deno.execPath();
  const r = await powershell(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psq(lnk)})
$s.TargetPath = ${psq(exe)}
$s.Arguments = '--background'
$s.WorkingDirectory = ${psq(dirname(exe))}
$s.IconLocation = ${psq(exe + ",0")}
$s.Description = ${psq(APP_NAME)}
$s.Save()
'ok'`);
  return r.code === 0;
}

export function autostartEnabled(): boolean {
  return existsSync(startupShortcut());
}
