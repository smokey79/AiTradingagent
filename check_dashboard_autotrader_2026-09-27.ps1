Write-Output "---DASHBOARD_ONLY env check---"
Select-String -Path F:\aitradingagent\.env -Pattern 'DASHBOARD_ONLY' -SimpleMatch
Write-Output "---ecosystem config check---"
Get-ChildItem F:\aitradingagent -Filter "ecosystem*.js" -Recurse -Depth 1 | ForEach-Object { Write-Output $_.FullName }
Write-Output "---dashboard out log: AutoTrader / ArbEngine startup lines---"
Get-Content C:\Users\barcl\.pm2\logs\dashboard-out.log -Tail 500 | Select-String -Pattern 'AutoTrader|ArbEngine|fully automated 24/7' | Select-Object -Last 30
