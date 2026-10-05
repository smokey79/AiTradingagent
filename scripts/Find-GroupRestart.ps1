$ErrorActionPreference = 'Continue'
$out = "F:\aitradingagent\logs\group-restart-search.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

$exclude = 'node_modules|\\venv\\|\\\.venv\\|\\logs\\|\\_archive\\|\\\.git\\|\\data\\'

"--- files containing 2+ of the 4 app names (whole repo) ---" | Out-File $out -Append -Encoding utf8
$files = Get-ChildItem -Path 'F:\aitradingagent' -Recurse -Include *.ps1,*.js,*.cjs,*.mjs,*.py,*.json -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $exclude }

foreach ($f in $files) {
  $content = $null
  try { $content = Get-Content -Path $f.FullName -Raw -ErrorAction Stop } catch { continue }
  if (-not $content) { continue }
  $hits = 0
  foreach ($name in @('hermes-analyst','mt5-feed','python-debate','arb-scanner')) {
    if ($content -match [regex]::Escape($name)) { $hits++ }
  }
  if ($hits -ge 3) {
    "$($f.FullName)  (matched $hits/4 names)" | Out-File $out -Append -Encoding utf8
  }
}
