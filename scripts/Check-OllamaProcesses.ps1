$out = "F:\aitradingagent\logs\ollama-proc-detail.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Get-CimInstance Win32_Process -Filter "Name LIKE 'ollama%'" |
  Select-Object ProcessId, Name, CommandLine, ParentProcessId |
  Format-List | Out-File $out -Append -Encoding utf8
"--- Ollama Windows service? ---" | Out-File $out -Append -Encoding utf8
Get-Service -Name '*ollama*' -ErrorAction SilentlyContinue | Format-List | Out-File $out -Append -Encoding utf8
"--- Ollama Startup shortcut? ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | Out-File $out -Append -Encoding utf8
