$out = "F:\aitradingagent\logs\bullbear-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

"--- does F:\aitradingagent\src\agents have bull/bear files? ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem "F:\aitradingagent\src\agents" -Filter "*bull*" -ErrorAction SilentlyContinue | Select-Object Name | Out-File $out -Append -Encoding utf8
Get-ChildItem "F:\aitradingagent\src\agents" -Filter "*bear*" -ErrorAction SilentlyContinue | Select-Object Name | Out-File $out -Append -Encoding utf8
Get-ChildItem "F:\aitradingagent\src\agents" -Filter "*meta*valuat*" -ErrorAction SilentlyContinue | Select-Object Name | Out-File $out -Append -Encoding utf8

"--- full agent file list in F:\aitradingagent\src\agents ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem "F:\aitradingagent\src\agents" -File -ErrorAction SilentlyContinue | Select-Object Name | Out-File $out -Append -Encoding utf8

"--- does F:\aitradingagent2\src\agents have bull/bear files? (the Tauric-style one) ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem "F:\aitradingagent2\src\agents" -ErrorAction SilentlyContinue | Select-Object Name | Out-File $out -Append -Encoding utf8

"--- is aitradingagent2 currently running under pm2 or as any process? ---" | Out-File $out -Append -Encoding utf8
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'aitradingagent2' } |
  Select-Object ProcessId, CommandLine | Out-File $out -Append -Encoding utf8

"--- AGENT_WEIGHTS block from live consensus.js (main project) ---" | Out-File $out -Append -Encoding utf8
Select-String -Path "F:\aitradingagent\src\orchestrator\consensus.js" -Pattern "^\s*\w+:\s*0\.\d+," | Out-File $out -Append -Encoding utf8
