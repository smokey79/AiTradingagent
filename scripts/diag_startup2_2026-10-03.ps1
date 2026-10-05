# diag_startup2_2026-10-03.ps1 -- READ-ONLY. Checks whether the logged dotenv crash is stale,
# lists JS source layout, and shows NON-SECRET mode flags from .env (names of other keys only).
$root = 'F:\aitradingagent'
Set-Location $root
"--- require('dotenv') from project root"
node -e "try{const d=require('dotenv');console.log('dotenv OK, version', require('dotenv/package.json').version)}catch(e){console.log('FAIL',e.message)}"
"--- node --check on entry points"
foreach ($f in 'src\orchestrator\index.js','src\orchestrator\autoTrader.js','src\orchestrator\consensus.js','src\duel\claudeSoloTrader.js','src\dashboard\server.js') {
  if (Test-Path $f) { $o = node --check $f 2>&1; if ($LASTEXITCODE -eq 0) { "OK   $f" } else { "FAIL $f : $o" } } else { "MISSING $f" }
}
"--- JS files by folder under src (excluding vendored python)"
Get-ChildItem "$root\src" -Directory | ForEach-Object {
  $n = (Get-ChildItem $_.FullName -Recurse -Filter *.js -ErrorAction SilentlyContinue | Measure-Object).Count
  "{0,-16} {1} js files" -f $_.Name, $n
}
"--- .env : mode flags (values shown only for non-secret flags)"
$safe = 'TRADING_MODE','PAPER_MODE','PAPER_TRADING','LIVE_TRADING','ENABLE_LIVE','DRY_RUN','NODE_ENV','PORT','MAX_LEVERAGE','MIN_ORDER_USD','MIN_ORDER','FEE_PCT','SLIPPAGE_PCT','OLLAMA_KEEP_ALIVE','OLLAMA_KEEPALIVE','HERMES_ANALYSIS_INTERVAL_S','EXCHANGE','BITGET_DEMO','BITGET_SANDBOX','LIVE_GATE_WIN_RATE','LIVE_GATE_MIN_TRADES'
$names = @()
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k = ($_ -split '=',2)[0].Trim(); $v = ($_ -split '=',2)[1].Trim()
  $names += $k
  if ($safe -contains $k) { "{0} = {1}" -f $k,$v }
}
"total keys: $($names.Count)"
"keys matching mode|live|paper|demo|fee|slip|min|ollama|gate|flash|arb (names only):"
$names | Where-Object { $_ -match 'MODE|LIVE|PAPER|DEMO|FEE|SLIP|MIN_|OLLAMA|GATE|FLASH|ARB|SANDBOX' } | Sort-Object -Unique
"--- pm2 saved dump present?"
Test-Path "$env:USERPROFILE\.pm2\dump.pm2"
