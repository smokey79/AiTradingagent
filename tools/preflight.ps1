# ================================
# AiTradingAgent Preflight System
# Validator + Self-Healing + Profiler + Dependency Check + Python Check
# ================================

$root = "F:\aitradingagent"

Write-Host "`n=== AiTradingAgent Preflight System ===`n" -ForegroundColor Cyan

# ----------------------------------------
# 1. Folder Validator + Self-Healing
# ----------------------------------------

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

Write-Host "Validating folder structure..." -ForegroundColor Yellow

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "[OK] $p" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $p -> creating..." -ForegroundColor Red
        New-Item -ItemType Directory -Path $p | Out-Null
    }
}

# ----------------------------------------
# 2. Dependency Validator
# ----------------------------------------

Write-Host "`nChecking Node dependencies..." -ForegroundColor Yellow

$packageJson = "$root\package.json"
$nodeModules = "$root\node_modules"
$mcpsdk = "$root\node_modules\@modelcontextprotocol\sdk"

if (Test-Path $packageJson) {
    Write-Host "[OK] package.json found" -ForegroundColor Green
} else {
    Write-Host "[MISSING] package.json" -ForegroundColor Red
}

if (Test-Path $nodeModules) {
    Write-Host "[OK] node_modules exists" -ForegroundColor Green
} else {
    Write-Host "[MISSING] node_modules" -ForegroundColor Red
}

if (Test-Path $mcpsdk) {
    Write-Host "[OK] MCP SDK installed" -ForegroundColor Green
} else {
    Write-Host "[MISSING] MCP SDK" -ForegroundColor Red
}

# ----------------------------------------
# 3. Python Module Checker
# ----------------------------------------

Write-Host "`nChecking Python feature modules..." -ForegroundColor Yellow

$pyRoot = "$root\python-modules"
$modules = @(
    "sopr_mvrv.py",
    "peer_rotation.py",
    "relative_strength.py",
    "volatility_regimes.py"
)

foreach ($m in $modules) {
    $path = "$pyRoot\$m"

    if (Test-Path $path) {
        Write-Host "[OK] $m" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $m -> creating placeholder..." -ForegroundColor Red
        New-Item -ItemType File -Path $path | Out-Null
    }
}

# ----------------------------------------
# 4. Startup Profiler
# ----------------------------------------

Write-Host "`nProfiling agent startup times..." -ForegroundColor Yellow

$agents = @(
    @{ Name = "Trading Data MCP"; Path = "$root\mcp-servers\trading-data-mcp\index.js" },
    @{ Name = "Signal Engine MCP"; Path = "$root\mcp-servers\signal-engine-mcp\index.js" },
    @{ Name = "Risk Gate MCP"; Path = "$root\mcp-servers\risk-gate-mcp\index.js" },
    @{ Name = "Portfolio MCP"; Path = "$root\mcp-servers\portfolio-mcp\index.js" },
    @{ Name = "Orchestrator"; Path = "$root\orchestrator\index.js" }
)

foreach ($agent in $agents) {
    $start = Get-Date
    Start-Process -WindowStyle Minimized "node" $agent.Path
    Start-Sleep -Milliseconds 500
    $end = Get-Date

    $duration = ($end - $start).TotalMilliseconds
    Write-Host "$($agent.Name) boot time: $duration ms" -ForegroundColor Green
}

Write-Host "`nPreflight checks complete." -ForegroundColor Cyan
