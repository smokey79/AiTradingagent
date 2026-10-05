$ErrorActionPreference = 'SilentlyContinue'
$pm2 = pm2 jlist | ConvertFrom-Json
$tracked = @{}
foreach ($p in $pm2) { $tracked[$p.name] = $p.pid }

Write-Output "=== PM2-tracked PIDs ==="
foreach ($k in $tracked.Keys) { Write-Output "$k -> $($tracked[$k])" }

Write-Output "`n=== All node.exe processes (pid, parentpid, start time, cmdline) ==="
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $age = (Get-Date) - $_.CreationDate
  [PSCustomObject]@{
    PID = $_.ProcessId
    ParentPID = $_.ParentProcessId
    AgeMin = [math]::Round($age.TotalMinutes,1)
    Cmd = $_.CommandLine
  }
} | Format-List
