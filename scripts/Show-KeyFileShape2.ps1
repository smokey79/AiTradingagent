# scripts/Show-KeyFileShape2.ps1 - deeper, still value-free description of one-line key files. 2026-09-24
# Reports character classes, separator positions and whether a known token pattern is embedded. Never prints the value.
param([Parameter(Mandatory = $true)][string]$Path)
foreach ($raw in Get-Content -Path $Path) {
  $v = $raw.Trim(); if (-not $v) { continue }
  $sep = ($v.ToCharArray() | Where-Object { $_ -notmatch '[A-Za-z0-9]' } | Select-Object -Unique) -join ' '
  $segs = ($v -split '[^A-Za-z0-9]+' | ForEach-Object { $_.Length }) -join '+'
  $hasOanda = $v -match '[0-9a-f]{32}-[0-9a-f]{32}'
  $hasAcct = $v -match '\d{3}-\d{3}-\d{6,8}-\d{3}'
  $lowerHexOnly = $v -cmatch '^[0-9a-f\-]+$'
  Write-Host "  length $($v.Length); separators: '$sep'; segment lengths: $segs; hex-only: $lowerHexOnly; contains OANDA token pattern: $hasOanda; contains OANDA account pattern: $hasAcct"
}
