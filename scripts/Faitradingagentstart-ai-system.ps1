# ================================
# AiTradingAgent Master Launcher
# Author: AlanJ
# Purpose: Start all MCP servers + all auxiliary modules
# ================================

Write-Host "Starting AiTradingAgent multi-agent system..." -ForegroundColor Cyan

# Root path for your project
$root = "F:\aitradingagent"

# Core MCP servers
$servers = @(
    @{ Name = "Trading Data MCP"; Path = "$root\mcp-servers\trading-data-mcp\index.js" },
    @{ Name = "Signal Engine MCP"; Path = "$root\mcp-servers\signal-engine-mcp\index.js" },
    @{ Name = "Risk Gate MCP"; Path = "$root\mcp-servers\risk-gate-mcp\index.js" },
    @{ Name = "Portfolio MCP"; Path = "$root\mcp-servers\portfolio-mcp\index.js" }
)

# Launch MCP servers
foreach ($srv in $servers) {
    Write-Host "Launching $($srv.Name)..." -ForegroundColor Green
    Start-Process -WindowStyle Minimized "node" $srv.Path
}

# Launch orchestrator
Write-Host "Launching Orchestrator..." -ForegroundColor Yellow
Start-Process -WindowStyle Normal "node" "$root\orchestrator\index.js"

# Launch Web Dashboard (agent health + logs)
Write-Host "Launching Web Dashboard..." -ForegroundColor Cyan
Start-Process -WindowStyle Normal "node" "$root\web-dashboard\index.js"

# Launch Real-Time Trade Visualizer
Write-Host "Launching Trade Visualizer..." -ForegroundColor Cyan
Start-Process -WindowStyle Normal "node" "$root\trade-visualizer\index.js"

# Launch Risk-Gate Tuning Panel
Write-Host "Launching Risk-Gate Tuning Panel..." -ForegroundColor Cyan
Start-Process -WindowStyle Normal "node" "$root\risk-tuning\index.js"

# Launch Backtesting Engine
Write-Host "Launching Backtesting Engine..." -ForegroundColor Cyan
Start-Process -WindowStyle Normal "node" "$root\backtester\index.js"

# Launch Telegram Bot
Write-Host "Launching Telegram Bot..." -ForegroundColor Cyan
Start-Process -WindowStyle Minimized "node" "$root\telegram-bot\index.js"

Write-Host "`nAiTradingAgent full system is now running." -ForegroundColor Green
