# scripts/append_env_example_oanda.ps1 - adds OANDA placeholder keys (no values) to .env.example once. 2026-09-24
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ex = Join-Path $root '.env.example'
if (-not (Test-Path $ex)) { Write-Host '.env.example not found - skipped'; exit 0 }
if (Select-String -Path $ex -Pattern '^OANDA_API_TOKEN=' -Quiet) { Write-Host 'OANDA keys already in .env.example'; exit 0 }
$block = @'

# --- OANDA (forex / commodities / indices, src/brokers/oandaBroker.js) ---
OANDA_ENV=practice
OANDA_API_TOKEN=
OANDA_ACCOUNT_ID=
OANDA_ALLOW_LIVE=false
'@
Add-Content -Path $ex -Value $block
Write-Host 'OANDA placeholder keys added to .env.example'
