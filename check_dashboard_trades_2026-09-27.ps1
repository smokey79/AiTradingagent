Write-Output "---dashboard out log: EXECUT/POSITION/riskGate lines---"
Get-Content C:\Users\barcl\.pm2\logs\dashboard-out.log -Tail 1500 | Select-String -Pattern 'Executing|Position opened|TRADE EXECUTED|riskGate|Risk Gate|VETO|REJECTED' | Select-Object -Last 25
Write-Output "---tail of tradeLedger.jsonl (last 15 lines)---"
Get-Content F:\aitradingagent\data\tradeLedger.jsonl -Tail 15
