# find_bitget_demo_env_2026-09-30.ps1 - read-only: locate bitget_demo.env (recently saved) and list its variable NAMES only.
$roots = 'F:\aitradingagent', "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents", 'C:\Users\AlanJ', 'F:\'
$found = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $depth = if ($r -eq 'F:\') { 1 } else { 3 }
  $found += Get-ChildItem $r -Recurse -Depth $depth -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '(?i)bitget.*demo|demo.*bitget' -and $_.FullName -notmatch '\\node_modules\\' }
}
$found = $found | Sort-Object FullName -Unique
if (-not $found) { "not found in: $($roots -join ', ')"; exit }
foreach ($f in $found) {
  "FILE: $($f.FullName)  (saved $($f.LastWriteTime), $($f.Length) bytes)"
  Get-Content $f.FullName | ForEach-Object {
    if ($_ -match '^\s*#' -or -not $_.Trim()) { return }
    if ($_ -match '^\s*([A-Za-z0-9_]+)\s*[=:]\s*(.*)$') { "   {0} = {1}" -f $Matches[1], $(if ($Matches[2].Trim()) { '<set, ' + $Matches[2].Trim().Trim('"').Length + ' chars>' } else { '<EMPTY>' }) }
    else { "   (line without NAME=value format, $($_.Length) chars)" }
  }
}
