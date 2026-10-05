# list_node_procs_2026-10-03.ps1 -- READ-ONLY. Lists node/python/powershell processes with their command lines (trimmed), to spot stray test runs.
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|python|pythonw|freqtrade)\.exe$' -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'run_extra|run_tests') } |
  ForEach-Object { $cl = $_.CommandLine; if ($cl.Length -gt 170) { $cl = $cl.Substring(0,170) }; "{0,6} {1,-12} started {2:HH:mm:ss}  {3}" -f $_.ProcessId, $_.Name, $_.CreationDate, $cl }
"--- pm2 status"
pm2 status --no-color
