$out = "F:\aitradingagent\logs\ollama-keepalive-fix.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

"--- BEFORE: memory ---" | Out-File $out -Append -Encoding utf8
$os = Get-CimInstance Win32_OperatingSystem
$usedPctBefore = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100,1)
"RAM used: $usedPctBefore%" | Out-File $out -Append -Encoding utf8

"--- setting OLLAMA_KEEP_ALIVE (User scope) to 10m ---" | Out-File $out -Append -Encoding utf8
[Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '10m', 'User')
"set." | Out-File $out -Append -Encoding utf8

"--- stopping ollama app + serve + llama-server ---" | Out-File $out -Append -Encoding utf8
Get-Process -Name 'ollama app','ollama','llama-server' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

"--- relaunching Ollama from its Startup shortcut ---" | Out-File $out -Append -Encoding utf8
Start-Process "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
Start-Sleep -Seconds 6

"--- verifying new env var is picked up by a fresh process ---" | Out-File $out -Append -Encoding utf8
powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','User')" | Out-File $out -Append -Encoding utf8

"--- ollama app / serve process check (should be running again) ---" | Out-File $out -Append -Encoding utf8
Get-Process -Name 'ollama app','ollama' -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize | Out-File $out -Append -Encoding utf8

"--- ollama ps right now (models should be unloaded until next call) ---" | Out-File $out -Append -Encoding utf8
ollama ps 2>&1 | Out-File $out -Append -Encoding utf8

"--- AFTER: memory ---" | Out-File $out -Append -Encoding utf8
$os2 = Get-CimInstance Win32_OperatingSystem
$usedPctAfter = [math]::Round((($os2.TotalVisibleMemorySize - $os2.FreePhysicalMemory) / $os2.TotalVisibleMemorySize) * 100,1)
"RAM used: $usedPctAfter%" | Out-File $out -Append -Encoding utf8
