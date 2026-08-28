# ================================
# AiTradingAgent Folder Validator + Self-Healing Installer
# ================================

$root = "F:\aitradingagent"

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
    "$root\service"
)

Write-Host "Validating AiTradingAgent folder structure..." -ForegroundColor Cyan

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "[OK] $p" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $p -> creating..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $p | Out-Null
    }
}

Write-Host "`nFolder validation + self-healing complete." -ForegroundColor Green
