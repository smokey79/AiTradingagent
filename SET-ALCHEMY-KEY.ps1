# SET-ALCHEMY-KEY.ps1 - run this YOURSELF (it asks for the key; the key is never shown or sent anywhere except Alchemy).
# 1. Asks for your Alchemy API key (hidden input)
# 2. Tests it against Alchemy's Arbitrum endpoint (asks for the latest block number)
# 3. If it works, saves ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key> into F:\aitradingagent\.env
#    (backs up .env first; replaces an existing ARBITRUM_RPC_URL line if there is one)
# The flash-loan simulator (flashloan-sim\hardhat.config.js) reads ARBITRUM_RPC_URL automatically.
$envFile = 'F:\aitradingagent\.env'
Write-Host "Paste your Alchemy API key and press Enter (nothing will show while you paste):" -ForegroundColor Cyan
$sec = Read-Host -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
if ($key -match 'g\.alchemy\.com/v2/([A-Za-z0-9_-]+)') { $key = $Matches[1] }   # accept a full URL too
if ($key -notmatch '^[A-Za-z0-9_-]{16,}$') { Write-Host "That doesn't look like an Alchemy key. Nothing was saved." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
$url = "https://arb-mainnet.g.alchemy.com/v2/$key"
try {
  $body = '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
  $r = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
  if (-not $r.result) { throw ($r.error.message) }
  Write-Host ("Key works - Arbitrum latest block {0}" -f [Convert]::ToInt64($r.result, 16)) -ForegroundColor Green
} catch {
  Write-Host "Alchemy rejected the key or Arbitrum isn't enabled on this app: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "In the Alchemy dashboard, open your app and make sure 'Arbitrum Mainnet' is ticked. Nothing was saved."
  Read-Host "Press Enter to close"; exit 1
}
Copy-Item $envFile "$envFile.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
$lines = [System.Collections.Generic.List[string]](Get-Content $envFile)
$i = -1; for ($j = 0; $j -lt $lines.Count; $j++) { if ($lines[$j] -match '^\s*ARBITRUM_RPC_URL\s*=') { $i = $j; break } }
if ($i -ge 0) { $lines[$i] = "ARBITRUM_RPC_URL=$url" } else { $lines.Add("ARBITRUM_RPC_URL=$url") }
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
$key = $null; $url = $null
Write-Host "Saved ARBITRUM_RPC_URL to .env (backup made). You can close this window and tell Claude 'done'." -ForegroundColor Green
Read-Host "Press Enter to close"
