# SET-DISCORD-WEBHOOK.ps1 - AiTradingAgent v4
# Adds (or replaces) DISCORD_WEBHOOK_URL in F:\aitradingagent\.env.
#  * Backs up .env first (.env.bak-<timestamp>), same convention as the other SET-*.ps1 scripts
#  * Hidden input - the URL is never printed or logged
#  * Writes UTF-8 WITHOUT BOM so .env never gets mojibake again
#  * The running discord-feed PM2 app picks the webhook up within 5 minutes - no restart needed
#
# Run (VS Code terminal, Ctrl+`):
#   powershell.exe -ExecutionPolicy Bypass -File F:\aitradingagent\SET-DISCORD-WEBHOOK.ps1

$ErrorActionPreference = 'Stop'
$Root    = 'F:\aitradingagent'
$EnvFile = Join-Path $Root '.env'
$Utf8    = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $EnvFile)) { throw ".env not found at $EnvFile" }

Write-Host ''
Write-Host 'Discord: Server Settings > Integrations > Webhooks > New Webhook > Copy Webhook URL' -ForegroundColor Cyan
$secure = Read-Host 'Paste the webhook URL (input hidden)' -AsSecureString
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try   { $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ($url -notmatch '^https://(canary\.|ptb\.)?(discord|discordapp)\.com/api/webhooks/\d+/[\w-]+$') {
    throw 'That does not look like a Discord webhook URL - nothing was changed.'
}

# 1. Backup
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$EnvFile.bak-$stamp"
Copy-Item $EnvFile $backup
Write-Host "[OK] Backup: $backup" -ForegroundColor Green

# 2. Remove any old DISCORD_WEBHOOK_URL line, then append the new one
$lines = [IO.File]::ReadAllLines($EnvFile, $Utf8) | Where-Object { $_ -notmatch '^\s*DISCORD_WEBHOOK_URL\s*=' }
$hasHeader = $lines -match '^# --- Discord feed ---'
$add = @()
if (-not $hasHeader) {
    $add += ''
    $add += '# --- Discord feed (scripts/discord_watcher.py, PM2 app "discord-feed") ---'
    $add += '# Optional: DISCORD_WEBHOOK_TRADES / _SIGNALS / _ALERTS / _SUMMARY for separate channels'
    $add += '# Optional: DISCORD_HEARTBEAT_MIN=60  DISCORD_SUMMARY_HOUR=21  DISCORD_STALE_MIN=90'
}
$add += "DISCORD_WEBHOOK_URL=$url"
[IO.File]::WriteAllLines($EnvFile, [string[]]($lines + $add), $Utf8)
$url = $null
Write-Host '[OK] DISCORD_WEBHOOK_URL saved to .env' -ForegroundColor Green

# 3. Make sure .env can never be committed
$gi = Join-Path $Root '.gitignore'
if (-not (Select-String -Path $gi -Pattern '^\.env$' -Quiet -ErrorAction SilentlyContinue)) {
    [IO.File]::AppendAllText($gi, "`n.env`n", $Utf8)
    Write-Host '[OK] .env added to .gitignore' -ForegroundColor Green
}

# 4. Send one test message right now
Push-Location $Root
try {
    & "$Root\venv\Scripts\python.exe" -c "import sys; sys.path.insert(0,'.'); from modules.discord_feed import feed; feed.info('Webhook connected', 'AiTradingAgent can post here.'); feed.flush(15)"
    Write-Host '[DONE] Check your Discord channel for "Webhook connected".' -ForegroundColor Cyan
} finally { Pop-Location }
