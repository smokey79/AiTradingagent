# recent_changes_2026-10-03.ps1 -- READ-ONLY. Lists files modified in the last N minutes (default 20), plus failing tests.
param([int]$Minutes = 20)
$root = 'F:\aitradingagent'
$cut = (Get-Date).AddMinutes(-$Minutes)
Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt $cut -and $_.FullName -notmatch '\\(node_modules|\.venv|venv|\.git|__pycache__)\\' } |
  Sort-Object LastWriteTime |
  Select-Object @{n='Modified';e={$_.LastWriteTime.ToString('HH:mm:ss')}}, Length, @{n='File';e={$_.FullName.Replace($root+'\','')}} |
  Format-Table -AutoSize | Out-String -Width 220
"--- failing tests in tests_before log"
Select-String -Path "$root\logs\tests_before_2026-10-03.txt" -Pattern '❌|FAIL' | Select-Object -First 10 | ForEach-Object { $_.Line }
"--- allocation_settings.json"
Get-Content "$root\data\allocation_settings.json" -Raw
