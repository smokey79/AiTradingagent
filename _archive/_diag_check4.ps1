Write-Host '=== Processes with ExecutablePath containing Temp or OllamaSetup ==='
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match 'Temp' -or $_.Name -match 'Setup' } |
    Select-Object ProcessId, Name, ExecutablePath, ParentProcessId | Format-List

Write-Host '=== Child processes of PID 12064 ==='
Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq 12064 } |
    Select-Object ProcessId, Name, CommandLine | Format-List
