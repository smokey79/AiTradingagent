# grep_files.ps1 -- READ-ONLY helper. Usage:
#   powershell -ExecutionPolicy Bypass -File grep_files.ps1 -Pattern "regex" -Paths "src\risk;src\utils" [-Max 40]
param([Parameter(Mandatory=$true)][string]$Pattern, [Parameter(Mandatory=$true)][string]$Paths, [int]$Max = 40)
$root = 'F:\aitradingagent'
$files = foreach ($p in $Paths.Split(';')) {
  $full = Join-Path $root $p.Trim()
  if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File -Include *.js,*.py,*.cjs,*.json,*.ps1 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|__pycache__|\.venv|venv)\\' } }
  elseif (Test-Path $full) { Get-Item $full }
}
$files | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First $Max | ForEach-Object {
  $t = $_.Line.Trim(); if ($t.Length -gt 160) { $t = $t.Substring(0,160) }
  "{0}:{1}: {2}" -f $_.Path.Replace($root + '\',''), $_.LineNumber, $t
}
