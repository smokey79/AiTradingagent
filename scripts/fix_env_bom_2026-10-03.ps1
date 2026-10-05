# fix_env_bom_2026-10-03.ps1 -- makes sure .env has NO UTF-8 BOM (a BOM can corrupt the first key for dotenv/shell loaders).
# Reports only bytes/key-count, never values.
$p = 'F:\aitradingagent\.env'
$bytes = [System.IO.File]::ReadAllBytes($p)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
"BOM present: $hasBom"
if ($hasBom) {
  $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  [System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding $false))
  $b2 = [System.IO.File]::ReadAllBytes($p)
  "BOM removed. first bytes now: {0:X2} {1:X2} {2:X2}" -f $b2[0],$b2[1],$b2[2]
}
$keys = (Get-Content $p | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' }).Count
"key lines: $keys"
$bak = Get-ChildItem 'F:\aitradingagent\.env.bak-20261003-212120'
$bb = [System.IO.File]::ReadAllBytes($bak.FullName)
"backup first bytes: {0:X2} {1:X2} {2:X2}" -f $bb[0],$bb[1],$bb[2]
"backup key lines: " + (Get-Content $bak.FullName | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' }).Count
