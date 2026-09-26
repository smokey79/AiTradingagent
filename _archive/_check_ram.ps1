$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [math]::Round($os.TotalVisibleMemorySize/1MB,2)
$freeGB  = [math]::Round($os.FreePhysicalMemory/1MB,2)
$usedPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
Write-Host "Total: $totalGB GB | Free: $freeGB GB | Used: $usedPct%"

Write-Host '--- top memory processes ---'
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 ProcessName, Id, @{n='WS_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}}
