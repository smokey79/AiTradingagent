# grep_map3_2026-10-03.ps1 -- READ-ONLY. Targeted lookups -> logs\grep_map3_2026-10-03.txt
$root = 'F:\aitradingagent'
$out  = "$root\logs\grep_map3_2026-10-03.txt"
"MAP3 $(Get-Date -Format s)" | Set-Content $out -Encoding utf8
function Find($label, $pattern, $paths) {
  "`n##### $label  /$pattern/" | Add-Content $out -Encoding utf8
  foreach ($p in $paths) {
    if (-not (Test-Path "$root\$p")) { continue }
    Get-ChildItem "$root\$p" -Recurse -Include *.py,*.js,*.cjs,*.json,*.ps1 -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\(node_modules|__pycache__|_OLD_BACKUPS|\.venv|venv)\\' } |
      Select-String -Pattern $pattern -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object {
        $t = $_.Line.Trim(); "{0}:{1}: {2}" -f $_.Path.Replace($root+'\',''), $_.LineNumber, $t.Substring(0,[Math]::Min(150,$t.Length)) | Add-Content $out -Encoding utf8 }
  }
}
Find 'learning agent users'        'after_trade|log_trade\(|LearningAgent\(|from agents.learning_agent|import learning_agent|TradeRecord\(' @('scripts','core','orchestrator','agents','api','bridge','web-dashboard','src\bridge','trading_api.py','main.py')
Find 'debate runner DB'            'learning|memory\.db|sqlite' @('scripts\debate_runner.py')
Find 'flash executors'             'def execute_live|executeFlashLoanArbitrage|function simulateFlashLoan|async function executeFlash|recordTrade' @('src\flashloan','src\bridge','src\arbitrage')
Find 'autoTrader arb usage'        'executeFlashLoanArbitrage|arbStatus|continuousArb|ARB_' @('src\orchestrator\autoTrader.js','src\orchestrator\index.js')
Find 'strategy_evidence cfg'       'EVIDENCE_|min_pf|min_oos|max_dd|min_trades' @('orchestrator\strategy_evidence.py')
Find 'trading.db users'            'trading\.db' @('scripts','core','src','orchestrator','api','web-dashboard','agents','data_sources')
Find 'PM2 / ollama autostart refs' 'ollama' @('tools\service.ps1','scripts\ConfigureAlwaysOn.ps1','START-ALL.bat','START-PAPER-TRADE.ps1')
"done -> $out"
