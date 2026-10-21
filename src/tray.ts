/**
 * Notification-area icon. A tiny WinForms NotifyIcon hosted by PowerShell polls /api/tray for its
 * labels, tooltip and pending balloons, and calls back into the server for menu actions. It exits
 * by itself when the server stops answering.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { log } from "./log.ts";
import { encodePs, psq } from "./system.ts";

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$base = 'http://127.0.0.1:__PORT__'
$headers = @{ 'X-Radar' = '1' }
function Call-Radar([string]$path) {
  try { return Invoke-RestMethod -Method Post -Uri ($base + $path) -Headers $headers -TimeoutSec 5 -UseBasicParsing }
  catch { return $null }
}
$icon = New-Object System.Windows.Forms.NotifyIcon
try { $icon.Icon = New-Object System.Drawing.Icon(__ICON__) } catch { $icon.Icon = [System.Drawing.SystemIcons]::Information }
$icon.Text = 'PreprintRadar'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('Open')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miRun = $menu.Items.Add('Recommend now')
$miPause = $menu.Items.Add('Pause')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miQuit = $menu.Items.Add('Quit')
$icon.ContextMenuStrip = $menu
$miOpen.add_Click({ [void](Call-Radar '/api/window') })
$miRun.add_Click({ [void](Call-Radar '/api/run') })
$miPause.add_Click({ [void](Call-Radar '/api/schedule/toggle') })
$miQuit.add_Click({
  $timer.Stop()
  [void](Call-Radar '/api/quit')
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { [void](Call-Radar '/api/window') } })
$icon.add_BalloonTipClicked({ [void](Call-Radar '/api/window?route=feed') })
$script:fails = 0
function Update-Tray {
  try {
    $s = Call-Radar '/api/tray'
    if ($null -eq $s) {
      $script:fails++
      if ($script:fails -ge 5) { $timer.Stop(); $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() }
      return
    }
    $script:fails = 0
    $icon.Text = [string]$s.tooltip
    $miOpen.Text = [string]$s.labels.open
    $miRun.Text = [string]$s.labels.run
    $miPause.Text = [string]$s.labels.pause
    $miQuit.Text = [string]$s.labels.quit
    $miRun.Enabled = -not $s.running
    foreach ($b in @($s.balloons)) {
      if ($b) { $icon.ShowBalloonTip(10000, [string]$b.title, [string]$b.body, [System.Windows.Forms.ToolTipIcon]::Info) }
    }
  } catch { }
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({ Update-Tray })
Update-Tray
$icon.Visible = $true
$timer.Start()
[System.Windows.Forms.Application]::Run()
$icon.Visible = $false
$icon.Dispose()
`;

let child: ChildProcess | null = null;
let stopping = false;
let restarts = 0;
const balloons: { title: string; body: string }[] = [];

export function queueBalloon(title: string, body: string) {
  balloons.push({ title, body });
  if (balloons.length > 5) balloons.shift();
}

export const takeBalloons = () => balloons.splice(0);
export const trayRunning = () => child !== null;

export function startTray(port: number, iconPath: string) {
  stopping = false;
  const script = SCRIPT.replaceAll("__PORT__", String(port)).replace("__ICON__", psq(iconPath));
  child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Sta", "-WindowStyle", "Hidden", "-EncodedCommand", encodePs(script, false)],
    { windowsHide: true, stdio: "ignore" },
  );
  child.on("exit", (code) => {
    log(`tray exited (${code})`);
    child = null;
    if (!stopping && restarts++ < 3) setTimeout(() => startTray(port, iconPath), 5000);
  });
}

export function stopTray() {
  stopping = true;
  try {
    child?.kill();
  } catch { /* gone */ }
  child = null;
}
