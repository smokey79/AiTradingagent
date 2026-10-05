# shape_bitget_files_2026-09-30.ps1 - read-only: find recently saved bitget*api* files in Downloads/Desktop/project and
# describe each line's SHAPE (length, first 3 chars, what it looks like) without revealing any value.
$roots = "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", 'F:\aitradingagent'
$files = foreach ($r in $roots) { if (Test-Path $r) { Get-ChildItem $r -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)bitget.*api|api.*bitget' } } }
foreach ($f in $files | Sort-Object LastWriteTime -Descending) {
  "FILE: $($f.FullName)  saved $($f.LastWriteTime)"
  foreach ($line in (Get-Content $f.FullName | Where-Object { $_.Trim() })) {
    $label = if ($line -match '^\s*([A-Za-z _-]{2,40})\s*[:=]\s*(\S.*)$') { $Matches[1].Trim() } else { '' }
    $val = if ($label) { $Matches[2].Trim().Trim('"') } else { $line.Trim() }
    $kind = if ($val -match '^bg_[0-9a-f]{32}$') { 'API KEY (bg_+32 hex)' } elseif ($val -match '^[0-9a-f]{64}$') { 'SECRET (64 hex)' } else { 'other' }
    "   label '{0}' | value {1} chars, starts '{2}' -> {3}" -f $label, $val.Length, $val.Substring(0, [Math]::Min(3, $val.Length)), $kind
  }
}
