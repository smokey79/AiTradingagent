# scripts/Set-OandaKeys.ps1 - saves your OANDA token + account ID into .env WITHOUT showing them. 2026-09-24
# The token is typed/pasted at a hidden prompt (nothing shown on screen, nothing kept in PowerShell history).
# Usage (from F:\aitradingagent):  powershell.exe -ExecutionPolicy Bypass -File scripts\Set-OandaKeys.ps1
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$setter = Join-Path $root 'scripts\Set-EnvValue.ps1'
$envPath = Join-Path $root '.env'

$secure = Read-Host 'Paste your OANDA API token (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($token.Length -lt 20) { Write-Host 'That token looks too short - nothing saved.'; exit 1 }

$acct = (Read-Host 'OANDA account ID (looks like 101-004-1234567-001)').Trim()
if ($acct -notmatch '^\d{3}-\d{3}-\d+-\d{3}$') { Write-Host 'Account ID format not recognised - nothing saved.'; exit 1 }

& $setter -Name 'OANDA_API_TOKEN' -Value $token -EnvPath $envPath
& $setter -Name 'OANDA_ACCOUNT_ID' -Value $acct -EnvPath $envPath
& $setter -Name 'OANDA_ENV' -Value 'practice' -EnvPath $envPath
$token = $null
Write-Host 'Saved (practice mode). Now test with:  node scripts\oanda_check.js'
