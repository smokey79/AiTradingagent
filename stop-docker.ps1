# AiTradingAgent Docker Shutdown
# Gracefully stop all services

$ProjectDir = "F:\aitradingagent"
$DockerDir = "$ProjectDir\docker"

# Set up console colors
$host.UI.RawUI.BackgroundColor = "Black"
$host.UI.RawUI.ForegroundColor = "Yellow"
Clear-Host

Write-Host @"
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║        🛑  AiTradingAgent Docker Shutdown                       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Yellow

Write-Host "`n⏳ Stopping all services..." -ForegroundColor Cyan

cd $DockerDir
docker compose down

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ All services stopped gracefully." -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Shutdown may have encountered issues." -ForegroundColor Yellow
}

Write-Host "`nTo view running containers: docker ps" -ForegroundColor Gray
Write-Host "To remove all data: docker compose down -v" -ForegroundColor Gray

Write-Host "`nPress any key to close..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
