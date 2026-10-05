$lines = Get-Content F:\aitradingagent\data\trade_ledger.json -Tail 4000
$arb = $lines | Where-Object { $_ -match '"symbol":"XRP"' -or $_ -match 'FLASHLOAN' -or $_ -match 'arbitrage' }
Write-Output "Total arb-ish ledger lines in tail sample: $($arb.Count)"
Write-Output "---last 10 raw---"
$arb | Select-Object -Last 10
