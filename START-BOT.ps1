# ============================================================
#  AiTradingAgent — Full Bot Startup Script
#  Run from PowerShell (no admin needed)
#
#  HOW TO RUN:
#  1. Open VS Code or Antigravity IDE
#  2. Press Ctrl + ` (backtick) to open the terminal
#  3. Paste this line and press Enter:
#     powershell -ExecutionPolicy Bypass -File "F:\aitradingagent\START-BOT.ps1"
# ============================================================

$projectRoot = $PSScriptRoot
if (-not (Test-Path $projectRoot)) {
    $projectRoot = "F:\aitradingagent"
}

$pythonExe = Join-Path $projectRoot "venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AiTradingAgent v4 — Starting Up" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check .env exists ─────────────────────────────────
$envFile = "$projectRoot\.env"
if (-not (Test-Path $envFile)) {
    $envFile = "$projectRoot\config\.env"
}
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env file not found at $projectRoot\.env or config\.env" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and fill in your API keys." -ForegroundColor Yellow
    exit 1
}
Write-Host "[1/5] .env found ($envFile)" -ForegroundColor Green

# ── Step 2: Check Ollama is running (needed for Hermes) ────────
Write-Host "[2/5] Checking Ollama (Hermes local model)..." -ForegroundColor White
try {
    $ollamaCheck = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 4
    $models = $ollamaCheck.models | Select-Object -ExpandProperty name
    if ($models -contains "hermes3") {
        Write-Host "      Ollama running. hermes3 model ready." -ForegroundColor Green
    } else {
        Write-Host "      Ollama running but hermes3 NOT found. Run: ollama pull hermes3" -ForegroundColor Yellow
        Write-Host "      (Bot will continue — hermes agent will fall back to HOLD)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "      Ollama not running. Checking executable..." -ForegroundColor Yellow
    $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $ollamaExe) {
        Start-Process $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
        Write-Host "      Ollama started (background). Waiting 5s..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    } else {
        Write-Host "      Ollama not installed. Download from https://ollama.com" -ForegroundColor Yellow
        Write-Host "      (Bot will continue — hermes agent will fall back to HOLD)" -ForegroundColor Yellow
    }
}

# ── Step 3: Check Node.js ─────────────────────────────────────
Write-Host "[3/5] Checking Node.js..." -ForegroundColor White
try {
    $nodeVer = & node --version 2>&1
    Write-Host "      Node.js $nodeVer found" -ForegroundColor Green
} catch {
    Write-Host "      ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ── Step 4: Check dependencies ───────────────────────────────
Write-Host "[4/5] Checking Python venv..." -ForegroundColor White
Write-Host "      Using Python: $pythonExe" -ForegroundColor Green

# ── Step 5: Choose run mode ───────────────────────────────────
Write-Host ""
Write-Host "[5/5] How do you want to run the bot?" -ForegroundColor White
Write-Host "  1 = Preview Build 1 (Live Web Dashboard on http://localhost:3002)" -ForegroundColor Green
Write-Host "  2 = Single consensus test (BTC/USDT, then exit)" -ForegroundColor Cyan
Write-Host "  3 = Full Stack (Dashboard + Multi-Agent Consensus)" -ForegroundColor Yellow
Write-Host ""
$choice = Read-Host "Enter 1, 2, or 3"

Set-Location $projectRoot

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Starting Preview Build 1 (Live Dashboard Server)..." -ForegroundColor Green
        Write-Host "Opening http://localhost:3002" -ForegroundColor Cyan
        Start-Process "http://localhost:3002"
        & $pythonExe wsgi.py
    }
    "2" {
        Write-Host ""
        Write-Host "Running single BTC/USDT consensus test (Python engine)..." -ForegroundColor Cyan
        Write-Host ""
        & $pythonExe orchestrator/consensus_engine.py --symbol BTC/USDT --paper
    }
    "3" {
        Write-Host ""
        Write-Host "Starting Preview Build 1 + Consensus in background..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; & '$pythonExe' wsgi.py"
        Start-Sleep -Seconds 3
        Start-Process "http://localhost:3002"
        & $pythonExe orchestrator/consensus_engine.py --symbol BTC/USDT --paper
    }
    default {
        Write-Host "Invalid choice. Run the script again." -ForegroundColor Red
    }
}
