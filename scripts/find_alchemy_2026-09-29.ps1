# find_alchemy_2026-09-29.ps1 - read-only: find env-style files that define an Alchemy key or Alchemy URL.
# Prints file + variable NAME + a short SHA256 fingerprint only - never the key itself.
$root = 'F:\aitradingagent'
$skip = '\\(node_modules|venv|\.venv|\.git)\\'
$sha = [System.Security.Cryptography.SHA256]::Create()
Get-ChildItem $root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $skip -and ($_.Name -match '\.env|\.txt$|\.ENV$|\.json$') -and $_.Length -lt 300kb } |
  ForEach-Object {
    $f = $_.FullName
    Select-String -Path $f -Pattern '(?i)(alchemy[A-Z_]*\s*[=:]\s*\S+|g\.alchemy\.com/v2/[A-Za-z0-9_-]+)' -ErrorAction SilentlyContinue | ForEach-Object {
      $line = $_.Line.Trim()
      $name = if ($line -match '^\s*"?([A-Za-z0-9_]+)"?\s*[=:]') { $Matches[1] } else { '(inline url)' }
      $key = if ($line -match 'g\.alchemy\.com/v2/([A-Za-z0-9_-]+)') { $Matches[1] } elseif ($line -match '[=:]\s*"?([A-Za-z0-9_-]{16,})') { $Matches[1] } else { '' }
      $fp = if ($key) { (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0,10) } else { 'no-key-value' }
      $net = if ($line -match '(?i)(eth|arb|opt|base|polygon|matic)-(mainnet|sepolia)') { $Matches[0] } else { '' }
      "{0,-11} {1,-28} {2,-16} {3}" -f $fp, $name, $net, $f.Replace($root, '.')
    }
  }
