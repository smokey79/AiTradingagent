# grep_map2_2026-10-03.ps1 -- READ-ONLY. Second code map -> logs\grep_map2_2026-10-03.txt
$root = 'F:\aitradingagent'
$out  = "$root\logs\grep_map2_2026-10-03.txt"
$dirs = 'src','agents','core','orchestrator','scripts','tools','data_sources','execution','risk','data','freqtrade-stable\user_data','api','bridge','analytics','backtester'
$files = foreach ($d in $dirs) { if (Test-Path "$root\$d") { Get-ChildItem "$root\$d" -Recurse -Include *.js,*.py,*.cjs,*.json,*.ps1 -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|__pycache__|_OLD_BACKUPS|\.venv|backtest_results|hyperopt_results|ohlcv|unified_data|cycle_C)\\' -and $_.Length -lt 600000 -and $_.FullName -notmatch 'src\\(api_|exchange|bit|binance|bybit|okx|kraken|coinex|bingx|backtest|freqai|Base|data_|deploy|arguments|cli_|constants|converter|dataprovider|datasets|db_|exceptions|check_|create_|analyze_)' } } }
$files = $files | Sort-Object FullName -Unique
$groups = [ordered]@{
  'DB_INSERT_TRADES' = 'INSERT INTO trades|INSERT OR REPLACE INTO trades|record_trade\(|\.add_trade\('
  'DB_AGENT_WEIGHTS' = 'agent_weights'
  'FLASH_WRITES'     = "FLASHLOAN|recordTrade\(.*flash"
  'OLLAMA_CALLS'     = 'api/generate|api/chat|ollama serve|OLLAMA_HOST|keep_alive'
  'MARKETDATA_BUILD' = 'indicators:|rsi14|candles\b.*fetch|fetchOHLCV'
  'FREQ_ENTER_TAG'   = 'enter_tag|exit_tag'
}
"MAP2 generated $(Get-Date -Format s)" | Set-Content $out
foreach ($g in $groups.Keys) {
  "`n##### $g  (/$($groups[$g])/)" | Add-Content $out
  $files | Select-String -Pattern $groups[$g] -ErrorAction SilentlyContinue | Group-Object Path | ForEach-Object {
    "{0}  ({1} hits)" -f $_.Name.Replace($root + '\',''), $_.Count | Add-Content $out
    $_.Group | Select-Object -First 3 | ForEach-Object { $t=$_.Line.Trim(); "    L{0}: {1}" -f $_.LineNumber, $t.Substring(0,[Math]::Min(140,$t.Length)) } | Add-Content $out
  }
}
"done -> $out"
