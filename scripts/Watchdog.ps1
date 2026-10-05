# Watchdog.ps1
# Purpose: keep the AiTradingAgent dashboard/bot running without Alan having to check on it.
# Read-only health check + restart-if-down. Never touches PAPER_TRADING, risk gates, or any
# trading config.
# UPDATED 2026-09-16: the whole stack (dashboard + orchestrator + risk-gate + arb-scanner +
# telegram-listener + etc, see ecosystem.config.cjs) is now supervised by PM2, which already
# auto-restarts a crashed process on its own. This script now only catches the case PM2 can't
# see -- the dashboard process is alive but HUNG (not responding to HTTP) -- and asks PM2 to
# start/reload just that app, rather than calling RestartBot.ps1 (which manages a raw node process
# outside PM2 and would fight PM2 for the same port). If the PM2 list is empty after an idle
# disconnect or reboot, startOrReload recreates dashboard from ecosystem.config.cjs.
# Run on a schedule (see MakeWatchdogTask.ps1). Safe to run every few minutes.

$ErrorActionPreference = 'SilentlyContinue'
$root = "F:\aitradingagent"
$logFile = Join-Path $root "logs\watchdog.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-Log($msg) {
    Add-Content -Path $logFile -Value "$timestamp $msg"
}

# --- Node-side orphan process reaper (added 2026-09-27, DISABLED 2026-09-27 later same day) ---
# Found live 2026-09-27 (first pass): PM2's autorestart on this Windows box does not always
# fully terminate the OLD process before starting a new one. A stale copy of
# src/orchestrator/index.js kept running for hours -- its own independent 8s arb-scan loop
# and LLM calls duplicated everything the new, PM2-tracked copy was doing, silently burning
# CPU (measured 97% -> 16% after reaping two of these) and eating shared daily quotas
# (Gemini, OpenRouter free tier) meant for one instance. This reaped any node.exe child of
# the PM2 daemon that PM2 itself no longer tracked.
#
# DISABLED: confirmed live, same pattern as the Python reaper below -- this is a single
# snapshot (`pm2 pid $app` then one Get-CimInstance pass) compared against the live process
# list. When trading-orchestrator was restarted for code changes (routine during active
# development), this reaper's snapshot could land mid-restart and kill the BRAND NEW,
# correct process, not a real orphan. PM2 then auto-restarted it, and the next 2-minute
# Watchdog cycle could repeat the same mistake -- caught live driving trading-orchestrator's
# restart count into the 170s, uptime never exceeding ~1-2 minutes, meaning it could never
# complete a full trading cycle. Left in place, commented out, until a safer version exists
# (e.g. only killing a match older than N minutes, so a process from the CURRENT restart
# cycle is never a target, same fix direction already applied to the Python reaper below).
# See claude/session-2026-09-27-*.md.
#
# try {
#     $pm2AppNames = @('risk-gate','trading-data','telegram-listener','dashboard','tradingkit-analyst','trading-orchestrator')
#     $trackedPids = @()
#     foreach ($app in $pm2AppNames) {
#         $p = (pm2 pid $app 2>$null | Select-Object -First 1)
#         if ($p -match '^\d+$') { $trackedPids += [int]$p }
#     }
#     $pm2Daemon = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'pm2\\lib\\Daemon\.js' } | Select-Object -First 1
#     if ($pm2Daemon) {
#         $children = Get-CimInstance Win32_Process -Filter "Name='node.exe' AND ParentProcessId=$($pm2Daemon.ProcessId)" | Where-Object { $_.CommandLine -match 'ProcessContainerFork' }
#         foreach ($child in $children) {
#             if ($trackedPids -notcontains $child.ProcessId) {
#                 Write-Log "ORPHAN node.exe pid $($child.ProcessId) (started $($child.CreationDate)) not tracked by pm2 -- killing it"
#                 Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
#             }
#         }
#     }
# } catch {
#     Write-Log "Orphan-reaper check failed: $($_.Exception.Message)"
# }

# --- Python-side orphan reaper (added 2026-09-27, DISABLED 2026-09-27) ---
# DISABLED: confirmed live this same day that this reaper was the cause of a
# runaway crash-loop, not a fix for one. Every "orphan" it logged had started
# only 60-120s earlier (one Watchdog cycle prior), not hours-old like the
# genuine zombie this was written to catch. Watching Win32_Process directly
# confirmed TWO real python.exe processes per app (arb-scanner, hermes-analyst,
# mt5-feed, python-debate) exist briefly around every restart; this reaper's
# single-snapshot `pm2 pid` comparison is racy against that window and was
# killing the live, in-use process roughly as often as any genuine duplicate --
# PM2 then auto-restarted it, and the 2-minute Watchdog cycle repeated the
# same mistake forever (68 restarts/~2 minutes measured on hermes-analyst
# alone). Left in place, commented out, until a safer version exists (e.g.
# only killing a match older than N minutes, so a process from the CURRENT
# restart cycle is never a target). See claude/session-2026-09-27-*.md.
#
# try {
#     $pyAppScripts = @{
#         'arb-scanner'    = 'arbitrage_scanner.py'
#         'hermes-analyst' = 'hermes_analyst.py'
#         'mt5-feed'       = 'mt5_market_feed.py'
#         'python-debate'  = 'debate_runner.py'
#     }
#     foreach ($app in $pyAppScripts.Keys) {
#         $scriptName = $pyAppScripts[$app]
#         $trackedPid = (pm2 pid $app 2>$null | Select-Object -First 1)
#         $trackedPid = if ($trackedPid -match '^\d+$') { [int]$trackedPid } else { -1 }
#         $matches = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
#             Where-Object { $_.CommandLine -match [regex]::Escape($scriptName) }
#         foreach ($m in $matches) {
#             if ($m.ProcessId -ne $trackedPid) {
#                 Write-Log "ORPHAN python.exe pid $($m.ProcessId) running $scriptName (started $($m.CreationDate), pm2's tracked pid for $app is $trackedPid) -- killing it"
#                 Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue
#             }
#         }
#     }
# } catch {
#     Write-Log "Python orphan-reaper check failed: $($_.Exception.Message)"
# }

try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/health' -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) {
        Write-Log "OK - dashboard responding"
        exit 0
    }
    Write-Log "WARN - dashboard responded with status $($r.StatusCode), starting/reloading"
} catch {
    Write-Log "DOWN - dashboard not responding ($($_.Exception.Message)), starting/reloading"
}

$restartOutput = & pm2 startOrReload "$root\ecosystem.config.cjs" --only dashboard --update-env 2>&1 | Out-String
Write-Log "pm2 startOrReload dashboard output:`r`n$restartOutput"
