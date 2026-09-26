$WshShell = New-Object -comObject WScript.Shell

# ── LAUNCH shortcut ──────────────────────────────────────────────────────────
$launch = $WshShell.CreateShortcut("$env:USERPROFILE\OneDrive\Desktop\AiTradingAgent.lnk")
$launch.TargetPath       = "F:\aitradingagent\LAUNCH.bat"
$launch.WorkingDirectory = "F:\aitradingagent"
$launch.WindowStyle      = 1
$launch.Description      = "Launch AiTradingAgent Dashboard"
$launch.IconLocation     = "F:\aitradingagent\icon.ico,0"
$launch.Save()
Write-Host "LAUNCH shortcut created on Desktop"

# ── STOP shortcut ────────────────────────────────────────────────────────────
$stop = $WshShell.CreateShortcut("$env:USERPROFILE\OneDrive\Desktop\StopAiTradingAgent.lnk")
$stop.TargetPath       = "F:\aitradingagent\STOP.bat"
$stop.WorkingDirectory = "F:\aitradingagent"
$stop.WindowStyle      = 1
$stop.Description      = "Stop AiTradingAgent"
$stop.IconLocation     = "%SystemRoot%\System32\shell32.dll,27"
$stop.Save()
Write-Host "STOP shortcut created on Desktop"

Write-Host ""
Write-Host "Done! Check your desktop for:"
Write-Host "  AiTradingAgent       <- double-click to LAUNCH"
Write-Host "  StopAiTradingAgent   <- double-click to STOP"
