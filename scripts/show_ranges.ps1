# show_ranges.ps1 -- READ-ONLY helper: print line ranges from several files.
# Usage: powershell -ExecutionPolicy Bypass -File show_ranges.ps1 -Spec "rel\path.js:10-40;other.py:1-30"
param([Parameter(Mandatory=$true)][string]$Spec)
$root = 'F:\aitradingagent'
foreach ($item in $Spec.Split(';')) {
  if (-not $item.Trim()) { continue }
  $parts = $item.Split(':'); $rel = $parts[0].Trim(); $rng = $parts[1].Trim().Split('-')
  $s = [int]$rng[0]; $e = [int]$rng[1]
  $p = Join-Path $root $rel
  "`n===== $rel  [$s-$e] ====="
  if (-not (Test-Path $p)) { "MISSING"; continue }
  $i = 0
  Get-Content $p | ForEach-Object { $i++; if ($i -ge $s -and $i -le $e) { "{0,4}: {1}" -f $i, $_ } }
}
