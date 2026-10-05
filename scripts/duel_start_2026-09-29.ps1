# duel_start_2026-09-29.ps1
# Starts the 24h PAPER duel: Bot A (multi-agent orchestrator) vs Bot B (claude-solo).
#  1. Backs up .env + Bot A state into runs\2026-09-29_duel\archive (nothing deleted)
#  2. Bot A settings: 250 start, leverage cap 5x, $30 floor, paper locks kept on
#  3. Resets Bot A's balance to 250 and gives it a fresh ledger; clears any old Bot B state
#  4. Starts the PM2 stack WITHOUT hermes-analyst (commentary-only; its model load
#     pushed RAM to ~95% and the orchestrator died on a memory check at 08:09)
#  5. Stops Windows sleeping on mains power so the 24h run isn't paused
#     (undo later with:  powercfg /change standby-timeout-ac 30)
$ErrorActionPreference = 'Stop'
$root = 'F:\aitradingagent'; Set-Location $root
$run = "$root\runs\2026-09-29_duel"; $arch = "$run\archive"
New-Item -ItemType Directory -Force $arch, "$root\data\duel" | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$utf8 = New-Object System.Text.UTF8Encoding($false)

Copy-Item .env ".env.bak-$stamp"
foreach ($f in 'data\trade_ledger.json','data\portfolio_state.json','data\duel\claude_state.json') { if (Test-Path $f) { Copy-Item $f "$arch\$(Split-Path $f -Leaf).$stamp" } }

$want = [ordered]@{ PAPER_TRADING='true'; TRADING_MODE='paper'; LIVE_TRADING='false'; EXECUTION_ENABLED='false'; NO_TRADES='true';
  INITIAL_DEPOSIT='250'; LEVERAGE_MAX='5'; MIN_MARGIN_BALANCE_USD='30'; DUEL_START_USD='250'; DUEL_FLOOR_USD='30'; DUEL_HOURS='24' }
$lines = [System.Collections.Generic.List[string]](Get-Content .env)
foreach ($k in $want.Keys) {
  $i = -1; for ($j = 0; $j -lt $lines.Count; $j++) { if ($lines[$j] -match "^\s*$k\s*=") { $i = $j; break } }
  if ($i -ge 0) { $lines[$i] = "$k=$($want[$k])" } else { $lines.Add("$k=$($want[$k])") }
}
[System.IO.File]::WriteAllLines("$root\.env", $lines, $utf8)

try { pm2 delete all 2>&1 | Out-Null } catch { }   # "No process found" is fine
[System.IO.File]::WriteAllText("$root\data\trade_ledger.json", '', $utf8)
$ps = @{ currentBalance = 250; totalPnL = 0; sessionPeakBalance = 250; updatedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$root\data\portfolio_state.json", $ps, $utf8)
Remove-Item "$root\data\duel\claude_state.json" -ErrorAction SilentlyContinue   # backed up above
$meta = @{ startUtc = (Get-Date).ToUniversalTime().ToString('o'); startUsd = 250; floorUsd = 30; maxLeverage = 5; hours = 24; mode = 'paper';
  botA = 'trading-orchestrator (multi-agent)'; botB = 'claude-solo (anthropic/claude-sonnet-5.5 via OpenRouter)'; alpaca = 'excluded for both: keys return 401' } | ConvertTo-Json
[System.IO.File]::WriteAllText("$run\duel_meta.json", $meta, $utf8)

$apps = 'risk-gate','trading-data','arb-scanner','python-debate','bigdata-analyst','tradingkit-analyst','mt5-feed','telegram-listener','trading-orchestrator','dashboard','freqtrade-bridge','claude-solo'
$ErrorActionPreference = 'Continue'   # pm2 writes normal progress to stderr
pm2 start ecosystem.config.cjs --only ($apps -join ',') --update-env 2>&1 | Out-Null
pm2 save 2>&1 | Out-Null
powercfg /change standby-timeout-ac 0
"duel started $(Get-Date -Format 'HH:mm:ss') - backups in $arch"
