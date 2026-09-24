# scripts/Show-KeyFileShape.ps1 - describes a credentials file WITHOUT revealing values. 2026-09-24
# For each non-empty line: key name (if any), value length, and what it looks like
# (e.g. OANDA token = 32hex-32hex, OANDA account = 000-000-0000000-000, MT5 login = digits).
# Usage: powershell.exe -ExecutionPolicy Bypass -File scripts\Show-KeyFileShape.ps1 -Path F:\OANDA_API.env.txt
param([Parameter(Mandatory = $true)][string]$Path)
if (-not (Test-Path $Path)) { Write-Host "Not found: $Path"; exit 1 }
$n = 0
foreach ($raw in Get-Content -Path $Path) {
  $n++
  $line = $raw.Trim()
  if (-not $line) { continue }
  if ($line.StartsWith('#')) { Write-Host "  line $n : comment ($($line.Length) chars)"; continue }
  $key = ''; $val = $line
  if ($line -match '^\s*([A-Za-z_][\w \-\.]*?)\s*[:=]\s*(.*)$') { $key = $Matches[1]; $val = $Matches[2].Trim().Trim('"').Trim("'") }
  $shape = switch -Regex ($val) {
    '^[0-9a-f]{32}-[0-9a-f]{32}$' { 'OANDA API token format'; break }
    '^\d{3}-\d{3}-\d+-\d{3}$'     { 'OANDA account ID format'; break }
    '^\d{5,12}$'                  { 'digits only (MT5 login number?)'; break }
    '^https?://'                  { 'a URL'; break }
    '^[A-Za-z][\w\.\-]*-(Demo|Live|Server|Real)[\w\-]*$' { 'looks like an MT5 server name'; break }
    '^\S+$'                       { 'single word/secret'; break }
    default                       { 'text with spaces' }
  }
  $k = if ($key) { "key '$key'" } else { 'no key name' }
  Write-Host "  line $n : $k, value $($val.Length) chars, $shape"
}
