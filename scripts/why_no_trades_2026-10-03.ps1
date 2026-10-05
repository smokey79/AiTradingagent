# why_no_trades_2026-10-03.ps1 -- READ-ONLY. What is actually stopping paper trades right now?
$sig = 'F:\aitradingagent\data\freqtrade_signals.json'
"signals file modified: " + (Get-Item $sig).LastWriteTime
$j = Get-Content $sig -Raw | ConvertFrom-Json
$rows = $j.signals.PSObject.Properties | ForEach-Object { $_.Value | Add-Member -NotePropertyName pair -NotePropertyValue $_.Name -PassThru }
"pairs in file: " + @($rows).Count + " | BUY/SELL: " + @($rows | Where-Object { $_.signal -in 'BUY','SELL' }).Count + " | approved_for_execution: " + @($rows | Where-Object { $_.approved }).Count
"confidence of non-HOLD signals:"
$rows | Where-Object { $_.signal -in 'BUY','SELL' } | Sort-Object confidence -Descending | Select-Object -First 12 | ForEach-Object { "  {0,-10} {1,-4} conf {2,-5} agents {3} approved {4}  {5}" -f $_.pair, $_.signal, $_.confidence, $_.agentsAgreeing, $_.approved, ([string]$_.reasoning).Substring(0, [Math]::Min(90, ([string]$_.reasoning).Length)) }
"--- skip reasons in the orchestrator log since restart (top):"
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 1500 | Select-String -Pattern 'Consensus skipped|Risk Gate:|data-quality gate' |
  ForEach-Object { ($_.Line -replace '^\d\d:\d\d:\d\d\s+\S+\s*', '') -replace '\[[A-Z0-9]+/USDT\]', '[PAIR]' -replace '\d+(\.\d+)?%', 'N%' } | Group-Object | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { "  {0,4}x  {1}" -f $_.Count, $_.Name.Substring(0, [Math]::Min(150, $_.Name.Length)) }
"--- Freqtrade bridge strategy entry rules:"
Select-String -Path 'F:\aitradingagent\freqtrade-stable\user_data\strategies\ConsensusBridgeStrategy.py' -Pattern 'min_conf|MIN_CONF|confidence|approved|agents' | Select-Object -First 14 | ForEach-Object { "  {0}: {1}" -f $_.LineNumber, $_.Line.Trim() }
"--- freqtrade dry-run trades so far (calibration DB):"
& 'F:\aitradingagent\.venv\Scripts\python.exe' -c "import sqlite3;c=sqlite3.connect('F:/aitradingagent/freqtrade-stable/freqtrade_calibration_dryrun.sqlite');print(c.execute('select count(*), sum(is_open) from trades').fetchone())"
