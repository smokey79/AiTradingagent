# grep_map_2026-10-03.ps1 -- READ-ONLY code map. Writes matches to logs\grep_map_2026-10-03.txt
$root = 'F:\aitradingagent'
$out  = "$root\logs\grep_map_2026-10-03.txt"
$dirs = 'src\orchestrator','src\duel','src\learning','src\risk','src\brokers','src\data','src\arbitrage','src\flashloan','src\utils','src\health','src\agents','agents','core','orchestrator','scripts','tools','data_sources','execution','risk'
$files = foreach ($d in $dirs) { if (Test-Path "$root\$d") { Get-ChildItem "$root\$d" -Recurse -Include *.js,*.py,*.cjs -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|__pycache__|_OLD_BACKUPS)\\' } } }
$files = $files | Sort-Object FullName -Unique
$groups = [ordered]@{
  'LEDGER_FILE'   = 'trade_ledger'
  'MEMORY_DB'     = 'agent_memory'
  'WON_LOST_MEM'  = 'won_trades_memory|lost_trades_memory'
  'MIN_ORDER'     = 'minOrder|MIN_ORDER|minNotional|min_notional|limits\.cost|MIN_TRADE|minTradeUsd'
  'FEES_SLIP'     = 'feePct|FEE_PCT|slippage|SLIPPAGE|takerFee|FEE_RATE|feeRate'
  'RSI_ATR'       = 'function .*rsi|const .*rsi *=|calcRsi|computeRsi|\batr\b *[:=(]|function .*atr|rsi *[:=] *calc'
  'WIN_GATE'      = 'RISK_MIN_WIN_RATE_GATE|winRateGate|68|250'
  'OLLAMA_KEEP'   = 'keep_alive|KEEP_ALIVE|keepalive|keepAlive'
}
"MAP generated $(Get-Date -Format s)" | Set-Content $out
foreach ($g in $groups.Keys) {
  "`n##### $g  (/$($groups[$g])/)" | Add-Content $out
  $hits = $files | Select-String -Pattern $groups[$g] -ErrorAction SilentlyContinue
  $hits | Group-Object Path | ForEach-Object {
    "{0}  ({1} hits)" -f $_.Name.Replace($root + '\',''), $_.Count | Add-Content $out
    $_.Group | Select-Object -First 4 | ForEach-Object { "    L{0}: {1}" -f $_.LineNumber, $_.Line.Trim().Substring(0,[Math]::Min(150,$_.Line.Trim().Length)) } | Add-Content $out
  }
}
"done -> $out"
