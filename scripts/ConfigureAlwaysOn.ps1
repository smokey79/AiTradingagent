# ConfigureAlwaysOn.ps1 -- 2026-09-16
# Makes the box stay awake and the bot stay supervised while Alan is away for a few days.
# Never touches PAPER_TRADING, risk gates, trading pairs, or any .env trading value.
$ErrorActionPreference = 'Continue'

Write-Host "=== 1. Power settings: no sleep/hibernate on AC, lid does nothing on AC ==="
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
Write-Host "Sleep/hibernate/lid-action (AC) now: never sleep, lid does nothing."

Write-Host "`n=== 2. Ollama keep-alive so Hermes stops unloading the model ==="
[System.Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "24h", "User")
Write-Host "OLLAMA_KEEP_ALIVE set to 24h (user env). Restarting Ollama so it picks it up..."
Get-Process "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$env:OLLAMA_KEEP_ALIVE = "24h"
Start-Process "C:\Users\barcl\AppData\Local\Programs\Ollama\ollama app.exe"
Start-Sleep -Seconds 5
Get-Process | Where-Object { $_.ProcessName -like "*ollama*" } | Select-Object ProcessName,Id

Write-Host "`n=== 3. Fix Watchdog scheduled task so it doesn't miss runs ==="
$task = Get-ScheduledTask -TaskName "AiTradingAgent Watchdog" -ErrorAction SilentlyContinue
if ($task) {
    $newSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
    Set-ScheduledTask -TaskName "AiTradingAgent Watchdog" -Settings $newSettings | Out-Null
    Write-Host "Watchdog task: battery restrictions removed, idle-stop removed."
} else {
    Write-Host "Watchdog task not found -- skipped."
}

Write-Host "`n=== 4. Start the full stack under PM2 ==="
Set-Location "F:\aitradingagent"
pm2 start ecosystem.config.cjs
Start-Sleep -Seconds 5
pm2 save
Write-Host "PM2 process list saved."

Write-Host "`n=== 5. Register PM2 to auto-resurrect after a reboot ==="
pm2-startup install
pm2 save

Write-Host "`n=== DONE ==="
