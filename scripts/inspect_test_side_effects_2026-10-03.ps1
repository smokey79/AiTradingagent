# inspect_test_side_effects_2026-10-03.ps1 -- READ-ONLY. What did the test run change in live data?
$root = 'F:\aitradingagent'
Set-Location $root
"--- trade_ledger.json (line count + sides/ids/reasons)"
$lines = Get-Content "$root\data\trade_ledger.json"
"lines: $($lines.Count)"
$lines | ForEach-Object { try { $o = $_ | ConvertFrom-Json; "{0} | {1} | {2} | {3} | paper={4} | {5}" -f $o.id,$o.pair,$o.side,$o.outcome,$o.paper,($o.reason.ToString().Substring(0,[Math]::Min(60,$o.reason.ToString().Length))) } catch { "unparseable line" } }
"--- portfolio_state.json"
Get-Content "$root\data\portfolio_state.json" -Raw
"--- vault_summary.json"
Get-Content "$root\data\vault_summary.json" -Raw
"--- git tracking of key data files"
git ls-files --error-unmatch data/allocation_settings.json 2>&1 | Select-Object -First 1
git ls-files --error-unmatch data/trade_ledger.json 2>&1 | Select-Object -First 1
git ls-files --error-unmatch data/portfolio_state.json 2>&1 | Select-Object -First 1
"--- git status (data only, short)"
git status --short -- data 2>&1 | Select-Object -First 25
"--- last git commit"
git log -1 --format='%h %ad %s' --date=iso 2>&1
"--- backups folder / snapshots with allocation_settings"
Get-ChildItem "$root\backups" -ErrorAction SilentlyContinue | Select-Object -First 15 Name,LastWriteTime | Format-Table -AutoSize | Out-String
Get-ChildItem "$root\.snapshots","$root\data" -Recurse -Filter 'allocation_settings*' -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime | Format-Table -AutoSize | Out-String -Width 200
"--- allocation_log.jsonl: last 3 modes/settings seen BEFORE test? (first lines of the 21:04 block)"
Get-Content "$root\data\allocation_log.jsonl" -Tail 3 | ForEach-Object { $_.Substring(0,[Math]::Min(220,$_.Length)) }
