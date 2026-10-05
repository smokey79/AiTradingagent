# diag_ollama_freqtrade_2026-10-03.ps1 -- READ-ONLY. Ollama autostart/env + freqtrade bridge config + strategy header.
$root = 'F:\aitradingagent'
"--- OLLAMA_KEEP_ALIVE (User / Machine / current process)"
[Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','User')
[Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','Machine')
"--- Ollama processes"
Get-Process | Where-Object { $_.ProcessName -like '*ollama*' } | Select-Object ProcessName,Id,@{n='MB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String
"--- autostart entries mentioning ollama"
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue | Select-Object * -ExcludeProperty PS* | Format-List | Out-String
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | Select-Object Name | Format-Table | Out-String
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'ollama|aitrading|hermes|trading' } | Select-Object TaskName,State | Format-Table -AutoSize | Out-String
"--- freqtrade bridge config (secrets masked)"
$cfgPath = "$root\freqtrade-stable\user_data\config_bridge_dryrun.json"
if (Test-Path $cfgPath) {
  $j = Get-Content $cfgPath -Raw | ConvertFrom-Json
  $keys = 'dry_run','dry_run_wallet','stake_currency','stake_amount','max_open_trades','trading_mode','margin_mode','timeframe','stoploss','fee','process_throttle_secs','tradable_balance_ratio'
  foreach ($k in $keys) { if ($j.PSObject.Properties.Name -contains $k) { "{0} = {1}" -f $k, ($j.$k | ConvertTo-Json -Compress) } }
  "exchange.name = " + $j.exchange.name
  "exchange.pair_whitelist = " + ($j.exchange.pair_whitelist -join ',')
  "pairlists = " + ($j.pairlists | ConvertTo-Json -Compress)
  "entry_pricing = " + ($j.entry_pricing | ConvertTo-Json -Compress)
  "exit_pricing  = " + ($j.exit_pricing | ConvertTo-Json -Compress)
  "unfilledtimeout = " + ($j.unfilledtimeout | ConvertTo-Json -Compress)
  "minimal_roi = " + ($j.minimal_roi | ConvertTo-Json -Compress)
  "all top-level keys: " + (($j.PSObject.Properties.Name) -join ',')
} else { "config_bridge_dryrun.json MISSING at $cfgPath" }
"--- user_data listing"
Get-ChildItem "$root\freqtrade-stable\user_data" -Depth 1 | Select-Object Name,Length | Format-Table -AutoSize | Out-String
"--- strategy file"
$sp = Get-ChildItem "$root\freqtrade-stable\user_data\strategies" -Filter 'ConsensusBridgeStrategy*.py' -ErrorAction SilentlyContinue
$sp | Select-Object Name,Length | Format-Table | Out-String
if ($sp) { $n=0; Get-Content $sp[0].FullName | ForEach-Object { $n++; "{0,4}: {1}" -f $n,$_ } }
