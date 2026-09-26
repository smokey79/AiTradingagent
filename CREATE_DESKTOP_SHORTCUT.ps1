$WshShell = New-Object -comObject WScript.Shell

# ── LAUNCH shortcut ──────────────────────────────────────────────────
$launch = $WshShell.CreateShortcut("$env:USERPROFILE\OneDrive\Desktop\AiTradingAgent.lnk")
$launch.TargetPath       = "F:\aitradingagent\LAUNCH.bat"
$launch.WorkingDirectory = "F:\aitradingagent"
$launch.WindowStyle      = 7   # minimised
$launch.IconLocation     = "F:\aitradingagent\trading_agent_icon.ico"
$launch.Description      = "Launch AiTradingAgent Dashboard"
$launch.Save()
Write-Host "Launch shortcut created" -ForegroundColor Green

# ── STOP shortcut ────────────────────────────────────────────────────
$stop = $WshShell.CreateShortcut("$env:USERPROFILE\OneDrive\Desktop\STOP AiTradingAgent.lnk")
$stop.TargetPath       = "F:\aitradingagent\STOP.bat"
$stop.WorkingDirectory = "F:\aitradingagent"
$stop.WindowStyle      = 1
$stop.IconLocation     = "%SystemRoot%\System32\shell32.dll,131"
$stop.Description      = "Stop AiTradingAgent"
$stop.Save()
Write-Host "Stop shortcut created" -ForegroundColor Green

Write-Host ""
Write-Host "Both shortcuts are on your desktop." -ForegroundColor Cyan
