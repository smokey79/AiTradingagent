$out = "F:\aitradingagent\logs\correlate.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

"--- watchdog.log tail (last 20) ---" | Out-File $out -Append -Encoding utf8
Get-Content "F:\aitradingagent\logs\watchdog.log" -Tail 20 | Out-File $out -Append -Encoding utf8

"--- pm2.log tail (last 60, SIGINT/exited/starting only) ---" | Out-File $out -Append -Encoding utf8
Get-Content "$env:USERPROFILE\.pm2\pm2.log" -Tail 400 |
  Select-String -Pattern 'hermes-analyst|arb-scanner|mt5-feed|python-debate' |
  Select-Object -Last 60 |
  Out-File $out -Append -Encoding utf8

"--- Task Scheduler history for AiTradingAgent Watchdog (last 10 runs) ---" | Out-File $out -Append -Encoding utf8
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'; Id=100,102,200,201} -MaxEvents 200 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'AiTradingAgent Watchdog' } |
  Select-Object -First 10 TimeCreated, Id, Message |
  Format-List | Out-File $out -Append -Encoding utf8
