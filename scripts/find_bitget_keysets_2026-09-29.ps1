# find_bitget_keysets_2026-09-29.ps1
# Finds every env-style file under F:\aitradingagent (excluding node_modules/venv/.git)
# that defines a BITGET API key, and prints a short SHA256 fingerprint of each key
# so different key sets can be told apart WITHOUT revealing the keys.
$root = 'F:\aitradingagent'
$skip = '\\(node_modules|venv|\.venv|\.git|freqtrade-stable\\\.venv)\\'
$files = Get-ChildItem $root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $skip -and ($_.Name -match '\.env' -or $_.Extension -in '.env','.txt','.ENV') -and $_.Length -lt 200kb }
$sha = [System.Security.Cryptography.SHA256]::Create()
foreach ($f in $files) {
  $lines = Get-Content $f.FullName -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*BITGET[A-Z_]*(KEY|DEMO)[A-Z_]*\s*=\s*\S' }
  foreach ($l in $lines) {
    $name, $val = $l -split '=', 2
    $val = $val.Trim().Trim('"').Trim("'")
    if ($val.Length -lt 8) { continue }
    $h = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($val)) | ForEach-Object { $_.ToString('x2') }) -join ''
    "{0,-12} {1,-28} {2}" -f $h.Substring(0,10), $name.Trim(), $f.FullName.Replace($root,'.')
  }
}
