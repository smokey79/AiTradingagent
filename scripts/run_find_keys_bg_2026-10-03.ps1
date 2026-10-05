# run_find_keys_bg_2026-10-03.ps1 -- stops any earlier discovery scan, then runs a fresh one in the background writing to a file (so a slow scan can't hang the tool).
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'find_key_files_2026-10-03' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; "stopped old scan PID " + $_.ProcessId }
$out = 'F:\aitradingagent\runs\2026-10-03_calibration\key_file_candidates.txt'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
Remove-Item $out -ErrorAction SilentlyContinue
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"& 'F:\aitradingagent\scripts\find_key_files_2026-10-03.ps1' -Depth 5 *> '$out'"
"started background scan -> $out"
