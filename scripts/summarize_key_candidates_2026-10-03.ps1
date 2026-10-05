# summarize_key_candidates_2026-10-03.ps1 -- READ-ONLY. Summarises the discovery output (names only; no file is opened).
$f = 'F:\aitradingagent\runs\2026-10-03_calibration\key_file_candidates.txt'
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'find_key_files_2026-10-03' }).Count
"scan still running: $running  | file size: " + (Get-Item $f).Length + " B | last write " + (Get-Item $f).LastWriteTime
$lines = Get-Content $f
$i = [array]::IndexOf($lines, ($lines | Where-Object { $_ -like '--- candidate key files*' } | Select-Object -First 1))
"--- header / project-like folders:"
$lines | Select-Object -First ([Math]::Max(1, [Math]::Min($lines.Count, $(if ($i -ge 0) { $i + 1 } else { 40 })))) | Select-Object -First 45
if ($i -ge 0) {
  $c = $lines | Select-Object -Skip ($i + 1) | Where-Object { $_.Trim() }
  "--- candidates by top-level folder (count):"
  $c | ForEach-Object { $p = ($_ -split '\s{2,}')[0].Trim(); $parts = $p.Split('\'); if ($parts.Count -ge 3) { $parts[0..2] -join '\' } else { $parts[0] } } | Group-Object | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { "  {0,4}  {1}" -f $_.Count, $_.Name }
  "--- .txt / .env files only (first 60):"
  $c | Where-Object { $_ -match '\.(txt|env)\s' -or $_ -match '\\\.env' } | Select-Object -First 60
}
