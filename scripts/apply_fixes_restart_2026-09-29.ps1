# apply_fixes_restart_2026-09-29.ps1
# 1) swap dead OPENROUTER_FREE_MODEL in .env for a live one (backup first, UTF8 no BOM)
# 2) restart ONLY the processes that load the edited files (orchestrator + python debate)
$root = 'F:\aitradingagent'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item "$root\.env" "$root\.env.bak-$stamp"
$lines = Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^OPENROUTER_FREE_MODEL=') { 'OPENROUTER_FREE_MODEL=inclusionai/ling-3.0-flash-sante:free' } else { $_ }
}
[System.IO.File]::WriteAllLines("$root\.env", $lines, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path "$root\.env" -Pattern '^OPENROUTER_FREE_MODEL=' | ForEach-Object { $_.Line }
Set-Location $root
pm2 restart trading-orchestrator python-debate --update-env | Out-Null
"restarted at $(Get-Date -Format HH:mm:ss)"
