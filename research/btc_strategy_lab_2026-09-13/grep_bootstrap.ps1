cd 'F:\aitradingagent\research\btc_strategy_lab_2026-09-13'
$json = Get-Content bootstrap_grid.json -Raw | ConvertFrom-Json
$json.PSObject.Properties.Name | Select-Object -First 3
Write-Output "---"
$json | ConvertTo-Json -Depth 6 | Select-String -Pattern 'ETH' -Context 0,0
