# find_key_files_2026-10-03.ps1 -- READ-ONLY discovery. Lists candidate API-key files by NAME / SIZE / DATE only. It never opens or prints a file's contents.
# Looks in: every local drive's top levels, your user folders (Desktop, Documents, Downloads, repos), and any folder named like aitradingagent*/aiagent*.
# Skips: node_modules, .git, virtual envs, caches, browser/credential stores, Windows and Program Files.
param([int]$Depth = 6)
$skip = 'node_modules|\\\.git\\|\\\.venv|\\venv\\|\\site-packages|\\__pycache__|\\AppData\\|\\Windows\\|\\Program Files|\\\$Recycle|\\System Volume|\\backups\\|\\runs\\|\\logs\\|\\\.cache|\\\.npm|\\dist\\|\\build\\|\\freqtrade-stable\\\.venv'
$roots = @()
# every local drive EXCEPT C: (C: is scanned only through your user folders below, so Windows/system areas are never walked)
foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\$' -and $_.Root -ne 'C:\' -and $_.Used -gt 0 })) { $roots += $d.Root }
$roots += "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\source", "$env:USERPROFILE\repos", "$env:USERPROFILE\Projects"
$roots = $roots | Where-Object { Test-Path $_ } | Select-Object -Unique
"roots scanned: " + ($roots -join ', ')
"--- project-like folders (names only):"
$dirs = foreach ($r in $roots) { Get-ChildItem $r -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(ai[-_ ]?trading[-_ ]?agent|aiagent|ai[-_ ]?agent|AI-Trading|hermes|openclaw)' -and $_.FullName -notmatch $skip } }
$dirs | Select-Object -Unique FullName | ForEach-Object { "  " + $_.FullName }
$namePat = '^(\.env($|[._-].*)|.*\.env(\.txt|\.local|\.example|\.bak)?|.*(api|apikey|api[_-]?key|keys?|secret|secrets|token|tokens|credentials?)[^\\]*\.(txt|env|md|json|csv))$'
$files = foreach ($r in $roots) { Get-ChildItem $r -File -Recurse -Depth $Depth -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $namePat -and $_.FullName -notmatch $skip -and $_.Length -lt 200KB -and $_.Length -gt 0 } }
$files = $files | Sort-Object FullName -Unique
"--- candidate key files: " + @($files).Count
$files | ForEach-Object { "{0,-110} {1,7} B  {2}" -f $_.FullName, $_.Length, $_.LastWriteTime.ToString('yyyy-MM-dd') }
