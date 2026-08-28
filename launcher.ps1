# AiTradingAgent - Background Service Manager
# Runs continuously in background - close this window safely

$ProjectDir = "F:\aitradingagent"
$DockerDir = "$ProjectDir\docker"
$StateFile = "$ProjectDir\.trading_state"

# Set up console
$host.UI.RawUI.BackgroundColor = "Black"
$host.UI.RawUI.ForegroundColor = "Cyan"
Clear-Host

Write-Host @"
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║    🚀  AiTradingAgent Background Service Manager  🚀           ║
║                                                                  ║
║              Services Running in Detached Mode                  ║
║             (Safe to close this window anytime)                 ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host "`n⏳ Initializing..." -ForegroundColor Yellow
Start-Sleep -Milliseconds 500

# Check Docker Desktop
Write-Host "`n🔍 Checking Docker Desktop..." -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker not found. Install Docker Desktop first:" -ForegroundColor Red
    Write-Host "   https://www.docker.com/products/docker-desktop" -ForegroundColor White
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}
Write-Host "✅ Docker Desktop detected" -ForegroundColor Green

# Check if services already running
Write-Host "`n🔍 Checking existing services..." -ForegroundColor Cyan
$runningServices = docker compose -f "$DockerDir\docker-compose.yml" ps --quiet 2>/dev/null
if ($runningServices) {
    Write-Host "✅ Services already running in background" -ForegroundColor Green
} else {
    Write-Host "⚠️  No services found, starting new instances..." -ForegroundColor Yellow
}

# Check .env file
Write-Host "`n🔍 Checking configuration (.env)..." -ForegroundColor Cyan
if (-not (Test-Path "$ProjectDir\.env")) {
    Write-Host "⚠️  .env not found. Creating from template..." -ForegroundColor Yellow
    Copy-Item "$ProjectDir\.env.example" "$ProjectDir\.env"
    Write-Host "✅ Created .env (configure your API keys)" -ForegroundColor Green
} else {
    Write-Host "✅ Configuration loaded" -ForegroundColor Green
}

# Start Docker services in detached mode
Write-Host "`n📦 Starting Docker services (background mode)..." -ForegroundColor Cyan
Write-Host "   Services will continue running after you close this window" -ForegroundColor Gray

cd $DockerDir
docker compose up -d --pull always

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ All services started in background!" -ForegroundColor Green
} else {
    Write-Host "❌ Docker Compose failed. Check Docker Desktop." -ForegroundColor Red
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Initialize trading state
if (-not (Test-Path $StateFile)) {
    @{
        status = "RUNNING"
        mode = "MANUAL"
        start_time = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        trade_count = 0
    } | ConvertTo-Json | Set-Content $StateFile
    Write-Host "✅ Trading state initialized (MANUAL mode)" -ForegroundColor Green
}

# Wait for dashboard with timeout
Write-Host "`n⏳ Waiting for dashboard (30 sec timeout)..." -ForegroundColor Yellow
$maxRetries = 15
$retries = 0
$dashboardReady = $false

while ($retries -lt $maxRetries -and -not $dashboardReady) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3002" -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $dashboardReady = $true
            break
        }
    } catch { }
    
    $retries++
    Write-Host "   Attempt $retries/$maxRetries..." -ForegroundColor Gray
    Start-Sleep -Seconds 2
}

if ($dashboardReady) {
    Write-Host "✅ Dashboard is ready!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Dashboard startup delayed (may take 30 more seconds)..." -ForegroundColor Yellow
}

# Display service URLs and controls
Write-Host @"

╔══════════════════════════════════════════════════════════════════╗
║                   📊  SERVICES RUNNING  📊                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Dashboard:       http://localhost:3002                         ║
║  Risk Gate:       http://localhost:3001                         ║
║  Signal Engine:   http://localhost:3003                         ║
║  Portfolio:       http://localhost:3004                         ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║              🔄  TRADING MODE CONTROLS                           ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Current Mode: MANUAL (multi-AI input, manual execution)        ║
║                                                                  ║
║  • TRADE button → Switches to AUTO mode (autonomous execution)  ║
║  • STOP button → Returns to MANUAL mode (AI input only)         ║
║  • All LLMs active in both modes for analysis & signals         ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                   💻  MANAGEMENT COMMANDS                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  View real-time logs:                                           ║
║    docker compose logs -f                                       ║
║                                                                  ║
║  Check specific service:                                        ║
║    docker compose logs -f dashboard                             ║
║    docker compose logs -f consensus-engine                      ║
║                                                                  ║
║  Stop all services:                                             ║
║    Use 'AiTradingAgent Stop.lnk' shortcut on desktop           ║
║                                                                  ║
║  View running containers:                                       ║
║    docker compose ps                                            ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Green

Write-Host "`n✨ Your AiTradingAgent is now running in the background!" -ForegroundColor Cyan
Write-Host "   Access dashboard anytime at http://localhost:3002" -ForegroundColor Cyan
Write-Host "`n🔄 System Status:" -ForegroundColor Yellow

# Display running services
docker compose ps --format "table {{.Service}}\t{{.Status}}" | foreach {
    if ($_ -match "running") {
        Write-Host "   ✅ $_" -ForegroundColor Green
    } elseif ($_ -match "Service") {
        Write-Host "   $_" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  $_" -ForegroundColor Yellow
    }
}

Write-Host "`n💡 Trading Flow:" -ForegroundColor Cyan
Write-Host "   1. Open dashboard → http://localhost:3002" -ForegroundColor White
Write-Host "   2. All LLMs provide signal analysis (Claude, Gemini, GPT-4, etc.)" -ForegroundColor White
Write-Host "   3. Click TRADE button → Auto-execute with risk gates" -ForegroundColor White
Write-Host "   4. Click STOP button → Return to manual review mode" -ForegroundColor White
Write-Host "   5. Each trade requires consensus + risk approval before execution" -ForegroundColor White

Write-Host "`n📌 NOTE: Services continue running after you close this window." -ForegroundColor Yellow
Write-Host "   Close the 'AiTradingAgent Stop.lnk' shortcut when done trading." -ForegroundColor Yellow

Write-Host "`nPress any key to close this window and continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Clear-Host
Write-Host "✅ Window closed. Services running in background." -ForegroundColor Green
Write-Host "`nAccess dashboard: http://localhost:3002" -ForegroundColor Cyan
