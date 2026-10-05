# SET-BITGET-DEMO-KEYS.ps1 - run this YOURSELF. Saves your Bitget DEMO API key, secret and passphrase into
# F:\aitradingagent\.env as BITGET_DEMO_API_KEY / BITGET_DEMO_SECRET / BITGET_DEMO_PASSPHRASE (separate from the
# live BITGET_* keys so they can never be mixed up), then tests them READ-ONLY against Bitget demo trading.
# Input is hidden; nothing is printed or sent anywhere except Bitget. .env is backed up first.
$root = 'F:\aitradingagent'; $envFile = "$root\.env"
function Ask($label) {
  Write-Host "Paste your Bitget DEMO $label and press Enter (hidden):" -ForegroundColor Cyan
  $s = Read-Host -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
}
$vals = [ordered]@{ BITGET_DEMO_API_KEY = (Ask 'API key'); BITGET_DEMO_SECRET = (Ask 'secret key'); BITGET_DEMO_PASSPHRASE = (Ask 'passphrase') }
if ($vals.Values | Where-Object { -not $_ }) { Write-Host "One of the values was empty. Nothing was saved." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
Copy-Item $envFile "$envFile.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
$lines = [System.Collections.Generic.List[string]](Get-Content $envFile)
foreach ($k in $vals.Keys) {
  $i = -1; for ($j = 0; $j -lt $lines.Count; $j++) { if ($lines[$j] -match "^\s*$k\s*=") { $i = $j; break } }
  if ($i -ge 0) { $lines[$i] = "$k=$($vals[$k])" } else { $lines.Add("$k=$($vals[$k])") }
}
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
$vals = $null
Write-Host "Saved. Testing against Bitget DEMO (read-only, no orders)..." -ForegroundColor Cyan
Set-Location $root
node scripts\test_bitget_demo_keys.js
if ($LASTEXITCODE -eq 0) { Write-Host "Demo keys work. Tell Claude 'bitget demo done'." -ForegroundColor Green }
else { Write-Host "Bitget rejected the keys. Make sure you created them while in DEMO mode (see instructions) and try again." -ForegroundColor Red }
Read-Host "Press Enter to close"
