# wait_and_show_2026-10-03.ps1 -- polls a report file until its last line starts with "done, exit" (or the timeout), then prints it. READ-ONLY.
param([string]$File, [int]$TimeoutSec = 240, [int]$Tail = 0)
$end = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $end) {
  $last = Get-Content $File -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($last -like 'done, exit*') { break }
  Start-Sleep -Seconds 4
}
if ($Tail -gt 0) { Get-Content $File | Select-Object -Last $Tail } else { Get-Content $File }
