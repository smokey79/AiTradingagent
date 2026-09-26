# LAUNCH-AGENT.ps1
# AiTradingAgent -- Full-Stack Launcher
# Sequence: Preflight -> Waitress check -> Ollama/Hermes -> PM2 -> Dashboard
# Run via desktop shortcut or: powershell -ExecutionPolicy Bypass -File LAUNCH-AGENT.ps1

$ErrorActionPreference = "Continue"
$projectRoot   = "F:\aitradingagent"
$envFile       = Join-Path $projectRoot ".env"
$dashboardPort = 3001

function Write-Step($n, $msg) { Write-Host ""; Write-Host "[$n/6] $msg" -ForegroundColor Yellow }
function Write-OK($msg)       { Write-Host "      OK  $msg" -ForegroundColor Green }
function Write-WARN($msg)     { Write-Host "      !!  $msg" -ForegroundColor Magenta }

Clear-Host
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   AiTradingAgent -- Full-Stack Launcher     " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# ---- 0. Preflight ----------------------------------------------------------
Write-Step 0 "Preflight"
if (Test-Path $envFile)    { Write-OK ".env found ($envFile)" } else { Write-WARN ".env missing at $envFile" }
if (Test-Path $projectRoot) {
    Write-OK "Project root: $projectRoot"
    Set-Location $projectRoot
} else {
    Write-Host "ERROR: $projectRoot not found. Aborting." -ForegroundColor Red; pause; exit 1
}
# Ensure logs dir exists (PM2 writes here)
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null; Write-OK "Created logs/" }
else { Write-OK "logs/ exists" }

# ---- 1. Python venv check --------------------------------------------------
Write-Step 1 "Python environment (venv)"
$venvPython = Join-Path $projectRoot "venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $pyCheck = & $venvPython -c "import pydantic, google.genai, requests; print('dependencies ready')" 2>&1
    Write-OK "Python venv ready ($pyCheck)"
} else {
    Write-WARN "venv\Scripts\python.exe not found -- falling back to system python"
}

# ---- 2. Ollama -------------------------------------------------------------
Write-Step 2 "Ollama"
$ollamaProc = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProc) {
    Write-OK "Ollama running (PID $($ollamaProc.Id))"
} else {
    Write-Host "      Starting Ollama serve..." -ForegroundColor Yellow
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 6
    Write-OK "Ollama started"
}

# ---- 3. Hermes3 model ------------------------------------------------------
Write-Step 3 "Hermes3 model"
$modelList = & ollama list 2>&1
if ($modelList -match "hermes3") {
    Write-OK "hermes3 ready"
} else {
    Write-Host "      Pulling hermes3 (first run -- may take minutes)..." -ForegroundColor Yellow
    & ollama pull hermes3
    Write-OK "hermes3 pull complete"
}

# ---- 4. PM2 full stack -----------------------------------------------------
Write-Step 4 "PM2 process stack"
# FIX 2026-09-13: was pointing at the older ecosystem.config.js, which never
# received the 2026-09-03 fix that disabled the two legacy Python engines
# (trading-api.py / autonomous_engine.py) that were corrupting the shared
# trade_ledger.json / portfolio_state.json by running alongside the real
# Node consensus loop. ecosystem.config.cjs is the current, de-conflicted
# process list (dashboard, trading-orchestrator, arb-scanner, python-debate,
# telegram-listener, freqtrade-bridge in dry-run, risk-gate, trading-data).
# Trading mode itself is controlled by PAPER_TRADING / EXECUTION_ENABLED /
# NO_TRADES in .env, not by a PM2 --env flag, so none is passed here.
$ecosystem = Join-Path $projectRoot "ecosystem.config.cjs"
if (Test-Path $ecosystem) {
    Write-Host "      Starting via ecosystem.config.cjs..." -ForegroundColor Yellow
    & pm2 start $ecosystem 2>&1 | Write-Host
} else {
    Write-WARN "ecosystem.config.cjs not found -- trying pm2 resurrect"
    & pm2 resurrect 2>&1 | Write-Host
}
Write-Host ""
& pm2 list

# ---- 5. YouTube agent (guard -- PM2 may already manage it) ----------------
Write-Step 5 "YouTube agent guard"
$ytRunning = & pm2 list 2>&1 | Select-String "youtube"
if ($ytRunning) {
    Write-OK "youtube-agent managed by PM2"
} else {
    $ytScript = Join-Path $projectRoot "youtubeSentimentAgent.js"
    if (Test-Path $ytScript) {
        & pm2 start $ytScript --name "youtube-agent" 2>&1 | Write-Host
        Write-OK "youtube-agent started"
    } else {
        Write-WARN "youtubeSentimentAgent.js not found -- skipping"
    }
}

# ---- 6. Dashboard ----------------------------------------------------------
Write-Step 6 "Dashboard"
$dashUrl = "http://localhost:$dashboardPort"
Start-Sleep -Seconds 4
Start-Process $dashUrl
Write-OK "Opened $dashUrl"

# ---- Summary ---------------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   Launch complete" -ForegroundColor Cyan
Write-Host "---------------------------------------------" -ForegroundColor Cyan
Write-Host "  Dashboard      : http://localhost:$dashboardPort"
Write-Host "  Flash loan logs: pm2 logs flashloan-scanner"
Write-Host "  All logs       : pm2 logs"
Write-Host "  Status         : pm2 list"
Write-Host "  Stop all       : pm2 stop all"
Write-Host "  Save state     : pm2 save"
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
