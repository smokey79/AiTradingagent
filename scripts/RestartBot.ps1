# RestartBot.ps1 - stop and restart AiTradingAgent cleanly from the desktop.
#
# Run:  powershell.exe -ExecutionPolicy Bypass -File F:\aitradingagent\scripts\RestartBot.ps1
# (the desktop shortcut created by scripts\MakeDesktopShortcut.ps1 does this for you)
#
# REWRITTEN 2026-09-23 -- the old version of this script bypassed PM2 entirely
# (it killed whatever was on port 3001 and started a bare, unsupervised
# `node src\dashboard\server.js`). Since 2026-09-16 this whole project runs
# as a 10-process PM2 fleet (risk-gate, trading-data, arb-scanner,
# python-debate, hermes-analyst, tradingkit-analyst, telegram-listener,
# trading-orchestrator, dashboard, freqtrade-bridge), with pm2-windows-startup
# installed so PM2 itself survives a reboot. Running the old script would
# have started a SECOND, unmanaged dashboard/orchestrator process fighting
# the PM2-managed ones for the same ports and the same trade_ledger.json --
# exactly the "two independent auto-trading engines running at once" bug
# already found and fixed once on 2026-09-16. This version restarts the
# real PM2 fleet instead of fighting it. (Old version backed up alongside
# this file as RestartBot.ps1.pre-pm2-backup.)
#
# SAFETY
#   It refuses to (re)start if PAPER_TRADING is not true, unless you pass
#   -AllowLive. Your Bitget keys are live and BITGET_SANDBOX/BITGET_TESTNET
#   are false, so PAPER_TRADING is the only thing standing between the bot
#   and real orders.

param(
    [int]    $Port       = 3001,
    [string] $ProjectDir = 'F:\aitradingagent',
    [switch] $AllowLive,          # required to start with PAPER_TRADING=false
    [switch] $NoBrowser           # skip opening the dashboard
)

$ErrorActionPreference = 'Stop'
$LogDir  = Join-Path $ProjectDir 'logs'

function Say($msg, $colour = 'Gray') { Write-Host $msg -ForegroundColor $colour }

Say ''
Say '  AiTradingAgent - restart (PM2 fleet)' 'Cyan'
Say '  ------------------------------------' 'Cyan'

# ---------------------------------------------------------------- 1. safety
$envFile = Join-Path $ProjectDir '.env'
if (-not (Test-Path $envFile)) { Say "  .env not found at $envFile" 'Red'; Read-Host 'Enter to close'; exit 1 }

$paper = (Select-String -Path $envFile -Pattern '^\s*PAPER_TRADING\s*=\s*(.+)$' |
          Select-Object -First 1).Matches.Groups[1].Value.Trim()

if ($paper -ne 'true' -and -not $AllowLive) {
    Say ''
    Say '  REFUSING TO START.' 'Red'
    Say "  PAPER_TRADING is '$paper', not 'true'." 'Red'
    Say '  Your Bitget keys are live and sandbox/testnet are both off, so this' 'Yellow'
    Say '  would place REAL orders with REAL money.' 'Yellow'
    Say ''
    Say '  If that is genuinely what you want, run the script again with' 'Gray'
    Say '  -AllowLive on the end. Otherwise set PAPER_TRADING=true in .env.' 'Gray'
    Say ''
    Read-Host '  Enter to close'
    exit 1
}
Say "  Mode          : $(if ($paper -eq 'true') {'PAPER (simulated money)'} else {'LIVE - REAL MONEY'})" `
    $(if ($paper -eq 'true') { 'Green' } else { 'Red' })

# ------------------------------------------------------------- 2. PM2 fleet
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $ProjectDir

Say '  Checking      : PM2 daemon'
$pingOk = $false
try { $r = pm2 ping 2>$null; if ($r -match 'pong') { $pingOk = $true } } catch { }
if (-not $pingOk) { Say '  Starting PM2 daemon...' 'Yellow' }

$jlistRaw = pm2 jlist 2>$null
$hasProcesses = $false
try { if (($jlistRaw | ConvertFrom-Json).Count -gt 0) { $hasProcesses = $true } } catch { }

if (-not $hasProcesses) {
    Say '  PM2 process list is empty - resurrecting saved fleet...' 'Yellow'
    pm2 resurrect
} else {
    Say '  Restarting    : full PM2 fleet (all 10 processes)'
    pm2 restart all
}

Start-Sleep -Seconds 2
pm2 save | Out-Null

# ------------------------------------------------------------- 3. verify
Say '  Waiting       : up to 60s for the dashboard to answer'
$up = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 4
        if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { }
}

Say ''
if ($up) {
    Say "  RUNNING       : http://localhost:$Port" 'Green'
    Say "                  http://localhost:$Port/votes.html   (live agent votes)" 'Green'
    Say "                  http://localhost:$Port/wallets.html (wallet balances)" 'Green'
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
} else {
    Say "  DID NOT START - nothing answering on port $Port yet." 'Red'
    Say '  Check status with: pm2 status' 'Yellow'
}

Say ''
Say '  PM2 status:' 'Cyan'
pm2 status

Say ''
Read-Host '  Enter to close'
