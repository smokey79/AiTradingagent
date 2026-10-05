$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== Stopping trading-orchestrator ==="
pm2 stop trading-orchestrator 2>&1 | Out-String
Start-Sleep -Seconds 3

Write-Output "`n=== Sweeping any leftover node.exe ProcessContainerFork not matching current pm2 pids ==="
$pm2 = pm2 jlist | ConvertFrom-Json
$trackedPids = $pm2 | ForEach-Object { $_.pid }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'ProcessContainerFork' } | ForEach-Object {
    if ($trackedPids -notcontains $_.ProcessId) {
        Write-Output "Killing stray PID $($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 2
Write-Output "`n=== Restarting trading-orchestrator alone ==="
pm2 restart trading-orchestrator 2>&1 | Out-String

Start-Sleep -Seconds 15
Write-Output "`n=== pm2 list after restart + 15s ==="
pm2 list 2>&1 | Out-String
