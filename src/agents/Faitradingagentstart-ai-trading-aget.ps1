
# ================================
# AiTradingAgent Unified Boot Script
# Author: AlanJ
# Purpose: Start all MCP servers + orchestrator
# ================================

Write-Host "Starting AiTradingAgent multi-agent system..." -ForegroundColor Cyan

# Root path for your project
$root = "F:\aitradingagent"

# Define all MCP servers
$servers = @(
    @{ Name = "Trading Data MCP"; Path = "$root\mcp-servers\trading-data-mcp\index.js" },
    @{ Name = "Signal Engine MCP"; Path = "$root\mcp-servers\signal-engine-mcp\index.js" },
    @{ Name = "Risk Gate MCP"; Path = "$root\mcp-servers\risk-gate-mcp\index.js" },
    @{ Name = "Portfolio MCP"; Path = "$root\mcp-servers\portfolio-mcp\index.js" }
)

# Start each MCP server
foreach ($srv in $servers) {
    Write-Host "Launching $($srv.Name)..." -ForegroundColor Green
    Start-Process -WindowStyle Minimized "node" $srv.Path
}

# Start orchestrator last
$orchestrator = "$root\orchestrator\index.js"
Write-Host "Launching Orchestrator..." -ForegroundColor Yellow
Start-Process -WindowStyle Normal "node" $orchestrator

Write-Host "AiTradingAgent system is now running." -ForegroundColor Cyan
