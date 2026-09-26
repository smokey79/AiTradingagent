<#
  StartTelegramListener.ps1 — starts the GramJS Telegram listener that keeps
  data/telegram_alpha.json topped up.

  WHY THIS EXISTS: intelligentSignalsAgent.js only accepts messages younger
  than 10 minutes. Without this listener running, the ingested data goes stale
  within 10 minutes and the agent abstains forever — which is exactly why
  "intelligent_signals" sat DEGRADED and telegram_channel logged "No Telegram
  signal" while 99 perfectly good messages sat in the data folder.

  Started with Start-Process so it OUTLIVES the shell that launched it (a
  process started from a child cmd dies with its parent's tree).

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\StartTelegramListener.ps1
          powershell -ExecutionPolicy Bypass -File scripts\StartTelegramListener.ps1 -Stop
#>
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
$log = Join-Path $logDir 'telegram-listener.out.log'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Find any existing listener by its command line, so we never start a second one.
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'telegramListener' }

if ($Stop) {
  if ($existing) {
    foreach ($p in $existing) { Stop-Process -Id $p.ProcessId -Force; Write-Host ("  stopped PID " + $p.ProcessId) }
  } else { Write-Host "  nothing to stop - no listener running" }
  return
}

if ($existing) {
  foreach ($p in $existing) { Write-Host ("  already running: PID " + $p.ProcessId) }
  return
}

Write-Host "  starting Telegram listener..."
Start-Process -FilePath 'node.exe' `
  -ArgumentList 'src\notifications\telegramListener.js' `
  -WorkingDirectory $root `
  -RedirectStandardOutput $log `
  -RedirectStandardError (Join-Path $logDir 'telegram-listener.err.log') `
  -WindowStyle Hidden

Start-Sleep -Seconds 6
$now = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'telegramListener' }
if ($now) {
  foreach ($p in $now) { Write-Host ("  RUNNING: PID " + $p.ProcessId) }
  Write-Host ("  log: " + $log)
} else {
  Write-Host "  FAILED to stay up - check the log:"
  if (Test-Path $log) { Get-Content $log -Tail 15 | ForEach-Object { Write-Host ("    " + $_) } }
  $err = Join-Path $logDir 'telegram-listener.err.log'
  if (Test-Path $err) { Get-Content $err -Tail 15 | ForEach-Object { Write-Host ("    ERR " + $_) } }
}
