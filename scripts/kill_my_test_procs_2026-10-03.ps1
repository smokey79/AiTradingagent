# kill_my_test_procs_2026-10-03.ps1 -- stops exactly the stray processes whose PIDs are passed in (space or comma separated) and nothing else.
param([string]$Pids)
foreach ($p in ($Pids -split '[ ,]+' | Where-Object { $_ })) {
  $proc = Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue
  if ($proc) { "stopping $($proc.ProcessName) PID $p"; Stop-Process -Id ([int]$p) -Force } else { "PID $p already gone" }
}
