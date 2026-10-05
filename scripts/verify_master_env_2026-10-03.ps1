# verify_master_env_2026-10-03.ps1 -- READ-ONLY, NAMES ONLY (never prints a value). Checks master.env, the .env changes, git-ignore and file permissions.
param([int]$WaitSec = 0)
$rep = 'F:\aitradingagent\runs\2026-10-03_calibration\master_env_apply.txt'
if ($WaitSec -gt 0) { for ($i = 0; $i -lt $WaitSec / 5; $i++) { if ((Get-Content $rep -ErrorAction SilentlyContinue | Select-Object -Last 1) -like 'done, exit*') { break }; Start-Sleep -Seconds 5 } }
"report tail:"; Get-Content $rep | Where-Object { $_ -match '^(wrote|backed up|updated|added|will fill|done|\.env needed)' }
$m = 'F:\aitradingagent\config\master.env'
"--- master.env: exists=$(Test-Path $m) size=$((Get-Item $m -ErrorAction SilentlyContinue).Length) B"
$names = Get-Content $m | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_.]*=' } | ForEach-Object { ($_ -split '=', 2)[0] }
"names in master.env: $(@($names).Count)"; ($names -join ', ')
"--- permissions on master.env:"; (icacls $m) -join ' | '
"--- git: ignored? "; Set-Location F:\aitradingagent; git check-ignore -v config/master.env 2>&1; "git status for the file: [" + ((git status --short config/master.env 2>&1) -join '') + "] (empty = untracked-and-ignored)"
git check-ignore -q .env; "'.env' ignored by git: " + ($LASTEXITCODE -eq 0)
"--- .env now vs backup: names added/changed (names only)"
$bak = Get-ChildItem F:\aitradingagent\backups\2026-10-03_master_env -Filter '.env.before-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($bak) {
  $old = @{}; Get-Content $bak.FullName | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_.]*)=(.*)$') { $old[$Matches[1]] = $Matches[2] } }
  $new = @{}; Get-Content F:\aitradingagent\.env | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_.]*)=(.*)$') { $new[$Matches[1]] = $Matches[2] } }
  "backup: " + $bak.Name + " | keys before $($old.Count), after $($new.Count)"
  "added:   " + ((($new.Keys | Where-Object { -not $old.ContainsKey($_) }) | Sort-Object) -join ', ')
  "changed: " + ((($new.Keys | Where-Object { $old.ContainsKey($_) -and $old[$_] -ne $new[$_] }) | Sort-Object) -join ', ')
  "removed: " + ((($old.Keys | Where-Object { -not $new.ContainsKey($_) }) | Sort-Object) -join ', ')
} else { "no backup found (nothing was changed in .env)" }
