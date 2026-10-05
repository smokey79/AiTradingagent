# INSTALL-DISCORD-FEED.ps1 - AiTradingAgent v4
# Validates and starts the "discord-feed" PM2 app (scripts/discord_watcher.py).
# Safe to re-run. Only starts/restarts discord-feed - never touches the trading apps.
#
#   powershell.exe -ExecutionPolicy Bypass -File F:\aitradingagent\INSTALL-DISCORD-FEED.ps1

$ErrorActionPreference = 'Stop'
$Root = 'F:\aitradingagent'
$Py   = "$Root\venv\Scripts\python.exe"
Set-Location $Root

foreach ($f in 'modules\discord_feed.py','scripts\discord_watcher.py','ecosystem.config.cjs') {
    if (-not (Test-Path $f)) { throw "Missing $f" }
}
if (-not (Test-Path 'modules\__init__.py')) { New-Item -ItemType File 'modules\__init__.py' | Out-Null }

# 1. Syntax check (Python + PM2 config)
& $Py -m py_compile modules\discord_feed.py scripts\discord_watcher.py
if ($LASTEXITCODE -ne 0) { throw 'Python syntax check failed' }
node -e "const c=require('./ecosystem.config.cjs'); if(!c.apps.find(a=>a.name==='discord-feed')) {process.exit(2)}"
if ($LASTEXITCODE -ne 0) { throw 'ecosystem.config.cjs does not load or has no discord-feed app' }
Write-Host '[OK] Syntax checks passed' -ForegroundColor Green

# 2. One dry cycle (posts only if a webhook is set)
& $Py scripts\discord_watcher.py --once
if ($LASTEXITCODE -ne 0) { throw 'Watcher test cycle failed' }
Write-Host '[OK] Test cycle ran' -ForegroundColor Green

# 3. Start / restart only discord-feed under PM2
$existing = (pm2 jlist 2>$null) -join ''
if ($existing -match '"name":"discord-feed"') { pm2 restart discord-feed --update-env | Out-Null }
else { pm2 start ecosystem.config.cjs --only discord-feed | Out-Null }
Start-Sleep 3
pm2 describe discord-feed | Select-String -Pattern 'status|restarts|out log path'
Write-Host '[DONE] discord-feed is running under PM2.' -ForegroundColor Cyan
Write-Host 'Note: run "pm2 save" only when ALL your bot apps are running, so the saved list stays complete.' -ForegroundColor Yellow
