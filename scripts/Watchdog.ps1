# Watchdog.ps1
# Purpose: keep the AiTradingAgent dashboard/bot running without Alan having to check on it.
# Read-only health check + restart-if-down. Never touches PAPER_TRADING, risk gates, or any
# trading config.
# UPDATED 2026-09-16: the whole stack (dashboard + orchestrator + risk-gate + arb-scanner +
# telegram-listener + etc, see ecosystem.config.cjs) is now supervised by PM2, which already
# auto-restarts a crashed process on its own. This script now only catches the case PM2 can't
# see -- the dashboard process is alive but HUNG (not responding to HTTP) -- and asks PM2 to
# restart just that app, rather than calling RestartBot.ps1 (which manages a raw node process
# outside PM2 and would fight PM2 for the same port).
# Run on a schedule (see MakeWatchdogTask.ps1). Safe to run every few minutes.

$ErrorActionPreference = 'SilentlyContinue'
$root = "F:\aitradingagent"
$logFile = Join-Path $root "logs\watchdog.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-Log($msg) {
    Add-Content -Path $logFile -Value "$timestamp $msg"
}

try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/config' -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) {
        Write-Log "OK - dashboard responding"
        exit 0
    }
    Write-Log "WARN - dashboard responded with status $($r.StatusCode), restarting"
} catch {
    Write-Log "DOWN - dashboard not responding ($($_.Exception.Message)), restarting"
}

$restartOutput = & pm2 restart dashboard 2>&1 | Out-String
Write-Log "pm2 restart dashboard output:`r`n$restartOutput"
