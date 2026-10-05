# show_master_report_2026-10-03.ps1 -- READ-ONLY. Condenses the build_master_env dry-run report (it contains names/lengths/status only, never values).
param([int]$WaitSec = 0)
$f = 'F:\aitradingagent\runs\2026-10-03_calibration\master_env_dryrun.txt'
if ($WaitSec -gt 0) { for ($i = 0; $i -lt $WaitSec / 5; $i++) { if ((Get-Content $f -ErrorAction SilentlyContinue | Select-Object -Last 1) -like 'done, exit*') { break }; Start-Sleep -Seconds 5 } }
$l = Get-Content $f
"last line: " + ($l | Select-Object -Last 1)
"--- header"; $l | Select-Object -First 1
"--- validation results (status only)"; $l | Where-Object { $_ -match 'candidate\(s\); using' }
"--- table rows that change something or have conflicting values"; $l | Where-Object { $_ -match 'WILL FILL|different values' }
"--- summary lines"; $l | Where-Object { $_ -match '^(names the code|wallet/signing|placeholder|exchange trading|current \.env value|will fill)' }
