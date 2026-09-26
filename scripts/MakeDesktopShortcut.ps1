# MakeDesktopShortcut.ps1 - puts "Restart AiTradingAgent" on your desktop.
# Run once:
#   powershell.exe -ExecutionPolicy Bypass -File F:\aitradingagent\scripts\MakeDesktopShortcut.ps1
# Re-run it any time to repair or update the shortcut.

param(
    [string] $ProjectDir = 'F:\aitradingagent',
    [string] $Name       = 'Restart AiTradingAgent',
    # By default the shortcut does NOT open a browser tab - it just restarts the
    # bot and prints the dashboard URLs. Pass -OpenBrowser if you want the old
    # behaviour of launching http://localhost:3001 on every restart.
    [switch] $OpenBrowser
)

$ErrorActionPreference = 'Stop'

$target = Join-Path $ProjectDir 'scripts\RestartBot.ps1'
if (-not (Test-Path $target)) { throw "RestartBot.ps1 not found at $target" }

$desktop  = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc    = $shell.CreateShortcut($linkPath)
$sc.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$browserArg          = if ($OpenBrowser) { '' } else { ' -NoBrowser' }
$sc.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$target`"$browserArg"
$sc.WorkingDirectory = $ProjectDir
$sc.IconLocation     = "$env:SystemRoot\System32\shell32.dll,238"   # green refresh arrows
$sc.Description      = 'Stop and restart the AiTradingAgent bot (paper mode only)'
$sc.WindowStyle      = 1
$sc.Save()

Write-Host ''
Write-Host "  Shortcut created: $linkPath" -ForegroundColor Green
Write-Host '  Double-click it any time to restart the bot.' -ForegroundColor Gray
Write-Host ''
