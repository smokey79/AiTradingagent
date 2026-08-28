# ================================
# AiTradingAgent Preflight + Launch
# ================================

$root = "F:\aitradingagent"

Write-Host "`n=== AiTradingAgent Preflight ===`n" -ForegroundColor Cyan

# 1. Folder Validator + Self-Healing
$paths = @(
    "$root\mcp-servers\trading-data-mcp",
    "$root\mcp-servers\signal-engine-mcp",
    "$root\mcp-servers\risk-gate-mcp",
    "$root\mcp-servers\portfolio-mcp",
    "$root\orchestrator",
    "$root\web-dashboard",
    "$root\trade-visualizer",
    "$root\risk-tuning",
    "$root\backtester",
    "$root\telegram-bot",
    "$root\logs",
    "$root\monitor",
    "$root\deploy",
    "$root\service",
    "$root\tools",
    "$root\python-modules"
)

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "[OK] $p" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $p -> creating..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $p | Out-Null
    }
}

# 2. Dependency Validator
$packageJson = "$root\package.json"
$nodeModules = "$root\node_modules"
$mcpsdk      = "$root\node_modules\@modelcontextprotocol\sdk"

if (Test-Path $packageJson) { Write-Host "[OK] package.json" -ForegroundColor Green } else { Write-Host "[MISSING] package.json" -ForegroundColor Red }
if (Test-Path $nodeModules) { Write-Host "[OK] node_modules" -ForegroundColor Green } else { Write-Host "[MISSING] node_modules" -ForegroundColor Red }
if (Test-Path $mcpsdk)      { Write-Host "[OK] MCP SDK" -ForegroundColor Green } else { Write-Host "[MISSING] MCP SDK" -ForegroundColor Red }

# 3. Python Module Checker
$pyRoot  = "$root\python-modules"
$modules = @("sopr_mvrv.py","peer_rotation.py","relative_strength.py","volatility_regimes.py")

foreach ($m in $modules) {
    $path = "$pyRoot\$m"
    if (Test-Path $path) {
        Write-Host "[OK] $m" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $m -> creating placeholder..." -ForegroundColor Yellow
        New-Item -ItemType File -Path $path | Out-Null
    }
}

# 4. Startup Profiler (core agents only)
$agents = @(
    @{ Name = "Trading Data MCP"; Path = "$root\mcp-servers\trading-data-mcp\index.js" },
    @{ Name = "Signal Engine MCP"; Path = "$root\mcp-servers\signal-engine-mcp\index.js" },
    @{ Name = "Risk Gate MCP"; Path = "$root\mcp-servers\risk-gate-mcp\index.js" },
    @{ Name = "Portfolio MCP"; Path = "$root\mcp-servers\portfolio-mcp\index.js" },
    @{ Name = "Orchestrator"; Path = "$root\orchestrator\index.js" }
)

Write-Host "`nProfiling agent startup times..." -ForegroundColor Yellow
foreach ($agent in $agents) {
    $start = Get-Date
    Start-Process -WindowStyle Minimized "node" $agent.Path
    Start-Sleep -Milliseconds 500
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    Write-Host "$($agent.Name) boot time: $duration ms" -ForegroundColor Green
}

Write-Host "`nPreflight complete. Launching full system..." -ForegroundColor Cyan

# ================================
# Launch phase
# ================================

# Core MCP servers already started above (profiler). Now launch aux modules.

# Web Dashboard (health + logs)
Start-Process -WindowStyle Normal "node" "$root\web-dashboard\index.js"

# Real-Time Trade Visualizer
Start-Process -WindowStyle Normal "node" "$root\trade-visualizer\index.js"

# Risk-Gate Tuning Panel
Start-Process -WindowStyle Normal "node" "$root\risk-tuning\index.js"

# Backtesting Engine
Start-Process -WindowStyle Normal "node" "$root\backtester\index.js"

# Telegram Bot
Start-Process -WindowStyle Minimized "node" "$root\telegram-bot\index.js"

Write-Host "`nAiTradingAgent full system is now running." -ForegroundColor Green
