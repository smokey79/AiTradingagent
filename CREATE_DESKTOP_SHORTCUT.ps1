# ================================================================
# CREATE_DESKTOP_SHORTCUT.PS1
# Creates Windows desktop shortcut for AiTradingAgent full stack
# Run: powershell -ExecutionPolicy Bypass -File CREATE_DESKTOP_SHORTCUT.ps1
# ================================================================

$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectRoot = "F:\aitradingagent"
$LaunchScript = "$ProjectRoot\launch-full-stack.bat"
$ShortcutPath = "$DesktopPath\AiTradingAgent.lnk"
$IconPath = "$ProjectRoot\icon.ico"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Creating Desktop Shortcut for AiTradingAgent" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verify launch script exists
if (-not (Test-Path $LaunchScript)) {
    Write-Host "[ERROR] launch-full-stack.bat not found at $LaunchScript" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Found launch script: $LaunchScript" -ForegroundColor Green

# Create COM object for shortcut
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

# Configure shortcut
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/k `"$LaunchScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 1  # Normal window
$Shortcut.Description = "Launch AiTradingAgent Full Stack (MCP servers, dashboard, backtester, visualizers)"
$Shortcut.Hotkey = "CTRL+ALT+T"  # Optional: set hotkey

# Set icon if available
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = "$IconPath, 0"
    Write-Host "[OK] Icon found: $IconPath" -ForegroundColor Green
} else {
    Write-Host "[INFO] Custom icon not found, using default command prompt icon" -ForegroundColor Yellow
    $Shortcut.IconLocation = "C:\Windows\System32\cmd.exe, 0"
}

# Save shortcut
$Shortcut.Save()

Write-Host ""
Write-Host "[OK] Shortcut created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Shortcut Details:" -ForegroundColor Cyan
Write-Host "  Location: $ShortcutPath"
Write-Host "  Name: AiTradingAgent"
Write-Host "  Target: $LaunchScript"
Write-Host "  Working Directory: $ProjectRoot"
Write-Host "  Hotkey: CTRL+ALT+T"
Write-Host ""
Write-Host "You can now:" -ForegroundColor Cyan
Write-Host "  1. Double-click the shortcut on your desktop to launch"
Write-Host "  2. Press CTRL+ALT+T to launch from anywhere (if enabled)"
Write-Host ""
