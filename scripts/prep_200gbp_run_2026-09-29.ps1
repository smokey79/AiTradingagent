# prep_200gbp_run_2026-09-29.ps1
# Prepares a clean 24h PAPER run with a GBP 200 (= USD 264.86 @ 1.3243) starting balance.
# - Backs up .env, trade_ledger.json, portfolio_state.json into runs\2026-09-29_200gbp\archive (nothing deleted)
# - Forces paper mode + a second execution lock in .env (no secrets printed)
# - Starts a fresh ledger and a fresh portfolio_state at 264.86
$ErrorActionPreference = 'Stop'
$root = 'F:\aitradingagent'
$run  = Join-Path $root 'runs\2026-09-29_200gbp'
$arch = Join-Path $run 'archive'
New-Item -ItemType Directory -Force -Path $arch | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Copy-Item "$root\.env" "$root\.env.bak-$stamp"
foreach ($f in 'trade_ledger.json','portfolio_state.json') {
  $src = Join-Path $root "data\$f"
  if (Test-Path $src) { Copy-Item $src (Join-Path $arch "$f.$stamp") }
}

# --- set/replace env keys ---
$want = [ordered]@{
  PAPER_TRADING     = 'true'
  TRADING_MODE      = 'paper'
  LIVE_TRADING      = 'false'
  EXECUTION_ENABLED = 'false'
  INITIAL_DEPOSIT   = '264.86'
}
$lines = [System.Collections.Generic.List[string]](Get-Content "$root\.env")
foreach ($k in $want.Keys) {
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*$k\s*=") { $idx = $i; break } }
  if ($idx -ge 0) { $lines[$idx] = "$k=$($want[$k])" } else { $lines.Add("$k=$($want[$k])") }
}
Set-Content -Path "$root\.env" -Value $lines -Encoding UTF8

# NOTE: the line above uses Set-Content; rewrite without BOM so dotenv reads the first key correctly
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines("$root\.env", $lines, $utf8NoBom)

# --- fresh ledger + portfolio state ---
[System.IO.File]::WriteAllText("$root\data\trade_ledger.json", '', $utf8NoBom)
$ps = @{ currentBalance = 264.86; totalPnL = 0; sessionPeakBalance = 264.86; updatedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$root\data\portfolio_state.json", $ps, $utf8NoBom)

# --- run metadata for the final report ---
$meta = @{ startUtc = (Get-Date).ToUniversalTime().ToString('o'); startGbp = 200; gbpUsd = 1.32428919; startUsd = 264.86; mode = 'paper' } | ConvertTo-Json
[System.IO.File]::WriteAllText("$run\run_meta.json", $meta, $utf8NoBom)

Write-Output "Backups in $arch and .env.bak-$stamp"
Get-Content "$root\.env" | Where-Object { $_ -match '^(PAPER_TRADING|TRADING_MODE|LIVE_TRADING|EXECUTION_ENABLED|INITIAL_DEPOSIT|NO_TRADES)=' }
Get-Content "$root\data\portfolio_state.json"
