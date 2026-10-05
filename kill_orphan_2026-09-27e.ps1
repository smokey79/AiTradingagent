$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== Before kill: node.exe processes matching ProcessContainerFork ==="
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*ProcessContainerFork*' } | Select-Object ProcessId, CreationDate

$orphanPid = 34424
$proc = Get-Process -Id $orphanPid -ErrorAction SilentlyContinue
if ($proc) {
  Write-Output "`nKilling confirmed orphan PID $orphanPid (not in current pm2 jlist tracked-pid set: 34300,29156,13516,34540,18804,10836,15740,1408,27964,28444,21620)"
  Stop-Process -Id $orphanPid -Force
  Start-Sleep -Seconds 2
  $stillThere = Get-Process -Id $orphanPid -ErrorAction SilentlyContinue
  Write-Output "Still running after kill attempt: $([bool]$stillThere)"
} else {
  Write-Output "PID $orphanPid not found (may have already exited or PIDs shifted)"
}

Write-Output "`n=== pm2 list after kill ==="
pm2 list 2>&1 | Out-String
