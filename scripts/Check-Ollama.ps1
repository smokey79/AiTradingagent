$out = "F:\aitradingagent\logs\ollama-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
"--- ollama ps (loaded models) ---" | Out-File $out -Append -Encoding utf8
ollama ps 2>&1 | Out-File $out -Append -Encoding utf8
"--- ollama list (installed models) ---" | Out-File $out -Append -Encoding utf8
ollama list 2>&1 | Out-File $out -Append -Encoding utf8
"--- llama-server process detail ---" | Out-File $out -Append -Encoding utf8
Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Select-Object ProcessId, CreationDate, CommandLine | Format-List | Out-File $out -Append -Encoding utf8
"--- claude process detail (grouped by command line) ---" | Out-File $out -Append -Encoding utf8
Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Select-Object ProcessId, @{N='MemMB';E={[math]::Round($_.WorkingSetSize/1MB,1)}}, CreationDate |
  Format-Table -AutoSize | Out-File $out -Append -Encoding utf8
