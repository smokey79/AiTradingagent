# demo_check_cycle_2026-10-03.ps1 -- READ-ONLY. After the demo has run a while: did a cycle finish, did the new gates fire, any code errors?
$out = Join-Path $env:USERPROFILE '.pm2\logs\trading-orchestrator-out.log'
$err = Join-Path $env:USERPROFILE '.pm2\logs\trading-orchestrator-error.log'
$lines = Get-Content $out -Tail 4000 -ErrorAction SilentlyContinue | ForEach-Object { $_ -replace '\x1b\[[0-9;]*m','' }
"orchestrator out-log lines scanned: $($lines.Count)"
"cycles finished (CYCLE DONE): " + ($lines | Where-Object { $_ -match 'CYCLE DONE' }).Count
"ExchangeLimits refresh lines:"; $lines | Where-Object { $_ -match 'ExchangeLimits' } | Select-Object -Last 2 | ForEach-Object { "  " + $_.Trim() }
"data-quality gate skips: " + ($lines | Where-Object { $_ -match 'Data-quality gate' }).Count
$lines | Where-Object { $_ -match 'Data-quality gate' } | Select-Object -First 4 | ForEach-Object { $x = $_.Trim(); if ($x.Length -gt 190) { $x = $x.Substring(0,190) }; "  " + $x }
"Allocation Manager lines (sample):"; $lines | Where-Object { $_ -match 'Allocation Manager' } | Select-Object -Last 3 | ForEach-Object { $x = $_.Trim(); if ($x.Length -gt 200) { $x = $x.Substring(0,200) }; "  " + $x }
"paper positions opened: " + ($lines | Where-Object { $_ -match 'PAPER POSITION OPENED' }).Count
"code errors (TypeError/ReferenceError/Cannot find/SyntaxError) in out+error logs:"
$errs = @($lines) + @(Get-Content $err -Tail 2000 -ErrorAction SilentlyContinue) | Where-Object { $_ -match 'TypeError|ReferenceError|SyntaxError|Cannot find module|is not a function|is not defined' }
if ($errs) { $errs | Select-Object -First 6 | ForEach-Object { $x = $_.Trim(); if ($x.Length -gt 200) { $x = $x.Substring(0,200) }; "  " + $x } } else { "  none" }
"--- data files"
foreach ($f in 'trade_ledger.json','freqtrade_signals.json','ledger.db') { $p = "F:\aitradingagent\data\$f"; if (Test-Path $p) { "{0,-24} {1,9} bytes  modified {2:HH:mm:ss}" -f $f,(Get-Item $p).Length,(Get-Item $p).LastWriteTime } else { "$f missing" } }
pm2 status --no-color
