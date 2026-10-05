# shape_bitget_demo_env_2026-09-30.ps1 - read-only: describe the SHAPE of the saved Bitget demo file without revealing it.
$f = 'C:\Users\barcl\Downloads\bitget_demo_API.env'
$raw = Get-Content $f -Raw
"lines: " + ($raw -split "`r?`n" | Where-Object { $_.Trim() }).Count
foreach ($line in ($raw -split "`r?`n" | Where-Object { $_.Trim() })) {
  $parts = $line.Trim() -split '[\s,;:|=]+' | Where-Object { $_ }
  "line has $($parts.Count) part(s):"
  foreach ($p in $parts) {
    $kind = if ($p -match '^bg_[0-9a-f]{32}$') { 'looks like a Bitget API KEY (bg_ + 32 hex)' }
            elseif ($p -match '^[0-9a-f]{64}$') { 'looks like a Bitget SECRET (64 hex)' }
            elseif ($p -match '^[A-Za-z_]+$' -and $p.Length -lt 30) { "a word ($($p.Length) letters) - maybe a label or passphrase" }
            else { 'other text' }
    "   {0,3} chars, starts '{1}' -> {2}" -f $p.Length, $p.Substring(0, [Math]::Min(3, $p.Length)), $kind
  }
}
