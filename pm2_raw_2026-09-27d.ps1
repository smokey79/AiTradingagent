$ErrorActionPreference = 'Continue'
Write-Output "=== which pm2 ==="
Get-Command pm2 -ErrorAction SilentlyContinue | Select-Object Source

Write-Output "`n=== pm2 list (human) ==="
pm2 list 2>&1 | Out-String

Write-Output "`n=== pm2 jlist raw (first 4000 chars) ==="
$raw = pm2 jlist 2>&1 | Out-String
$raw.Substring(0, [Math]::Min(4000, $raw.Length))
