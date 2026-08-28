<#
.SYNOPSIS
    AiTradingAgent Master Launcher & Control Matrix
.DESCRIPTION
    Interactive PowerShell menu for running consensus cycles, backtesting,
    data pipelines, data sourcer audits, test suites, and Waitress WSGI dashboards.
#>

param (
    [string]$Action = "",
    [switch]$NonInteractive
)

function Show-Header {
    Clear-Host
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "         ⚡ AI TRADING AGENT - MASTER CONTROL MATRIX             " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host " Universe: BTC, ETH, CRO, SOL, AVAX, ARB, OP                     " -ForegroundColor Gray
    Write-Host " Feeds: CCXT + SoSoValue + On-Chain SOPR/MVRV + Data Sourcer    " -ForegroundColor Gray
    Write-Host " Engine: Multi-Agent Consensus + 72% Win-Rate Gate + Waitress   " -ForegroundColor Gray
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Wait-IfInteractive {
    if (-not $NonInteractive -and -not $Action) {
        Write-Host "`nPress any key to continue..." -ForegroundColor Green
        try {
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        } catch {}
    }
}

function Invoke-Consensus {
    param([string]$Pair = "BTC/USDT")
    Write-Host "`n🚀 Launching Multi-Agent Consensus Cycle for $Pair..." -ForegroundColor Yellow
    python orchestrator/consensus_engine.py --symbol $Pair --paper
    Wait-IfInteractive
}

function Invoke-Pipeline {
    Write-Host "`n📡 Fetching Live Market Data, Institutional Macro, and Risk Gate..." -ForegroundColor Yellow
    python data_pipeline.py
    Wait-IfInteractive
}

function Invoke-Sourcer {
    Write-Host "`n🎯 Running Agent Data Sourcer & Feed Quality Audit..." -ForegroundColor Yellow
    python orchestrator/data_sourcer_agent.py
    Wait-IfInteractive
}

function Invoke-Backtest {
    Write-Host "`n📊 Running Quantitative Backtest Engine on Historical Candles..." -ForegroundColor Yellow
    python backtester/engine.py
    Wait-IfInteractive
}

function Invoke-SystemTests {
    Write-Host "`n🧪 Executing Full Automated Test Suite..." -ForegroundColor Yellow
    python tests/test_full_system.py
    Wait-IfInteractive
}

function Start-WebDashboard {
    Write-Host "`n🌐 Launching Production Web Dashboard with Waitress WSGI..." -ForegroundColor Cyan
    Write-Host "Developments Studio: http://localhost:3002" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop the web server." -ForegroundColor Yellow
    python wsgi.py
}

if ($Action -eq "consensus") { Invoke-Consensus; exit }
if ($Action -eq "pipeline")  { Invoke-Pipeline; exit }
if ($Action -eq "sourcer")   { Invoke-Sourcer; exit }
if ($Action -eq "backtest")  { Invoke-Backtest; exit }
if ($Action -eq "test")      { Invoke-SystemTests; exit }
if ($Action -eq "dashboard") { Start-WebDashboard; exit }

while ($true) {
    Show-Header
    Write-Host "Select an option:" -ForegroundColor White
    Write-Host " [1] 🤖 Run Multi-Agent Consensus Cycle (BTC/USDT)" -ForegroundColor White
    Write-Host " [2] 🪙 Run Consensus on Custom Token (ETH, SOL, AVAX, ARB, OP, CRO)" -ForegroundColor White
    Write-Host " [3] 📡 Run Live Data Pipeline & Macro Summary" -ForegroundColor White
    Write-Host " [4] 🎯 Run Agent Data Sourcer & Hit-Rate Audit" -ForegroundColor White
    Write-Host " [5] 📊 Run Quantitative Strategy Backtester" -ForegroundColor White
    Write-Host " [6] 🧪 Run Full Automated Test Suite" -ForegroundColor White
    Write-Host " [7] 🌐 Launch Developments Studio & Web Dashboard (Waitress WSGI)" -ForegroundColor White
    Write-Host " [Q] ❌ Exit" -ForegroundColor Red
    Write-Host ""

    $choice = Read-Host "Enter selection [1-7 or Q]"

    switch ($choice.ToUpper()) {
        "1" { Invoke-Consensus "BTC/USDT" }
        "2" {
            $token = Read-Host "Enter token symbol (e.g. ETH/USDT, SOL/USDT, CRO/USDT)"
            if (-not $token) { $token = "ETH/USDT" }
            Invoke-Consensus $token
        }
        "3" { Invoke-Pipeline }
        "4" { Invoke-Sourcer }
        "5" { Invoke-Backtest }
        "6" { Invoke-SystemTests }
        "7" { Start-WebDashboard }
        "Q" {
            Write-Host "`nExiting AI Trading Matrix. Goodbye!`n" -ForegroundColor Green
            exit
        }
        default {
            Write-Host "Invalid choice. Please choose 1-7 or Q." -ForegroundColor Yellow
            Start-Sleep -Seconds 1
        }
    }
}
