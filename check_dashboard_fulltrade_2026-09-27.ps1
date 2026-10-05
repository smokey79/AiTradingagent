Write-Output "---dashboard out log: Master Consensus / consensus pipeline lines---"
Get-Content C:\Users\barcl\.pm2\logs\dashboard-out.log -Tail 800 | Select-String -Pattern 'Master Consensus|Initiating multi-agent|APPROVED|EXECUTING TRADE' | Select-Object -Last 20
Write-Output "---dashboard error log tail---"
Get-Content C:\Users\barcl\.pm2\logs\dashboard-error.log -Tail 40
