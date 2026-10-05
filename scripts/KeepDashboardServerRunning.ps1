# KeepDashboardServerRunning.ps1
# Keeps the dashboard server supervised without starting the trading bot fleet.
# It does not edit .env, risk gates, paper/live mode, or trading settings.
$ErrorActionPreference = 'Continue'

$Root = 'F:\aitradingagent'
$LogDir = Join-Path $Root 'logs'
$WatchdogName = 'AiTradingAgent Watchdog'
$WatchdogScript = Join-Path $Root 'scripts\Watchdog.ps1'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host '=== Power settings: keep the machine awake on AC ==='
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setactive SCHEME_CURRENT

Write-Host "`n=== Start or reload dashboard only under PM2 ==="
Set-Location $Root
pm2 startOrReload ecosystem.config.cjs --only dashboard --update-env
pm2 save

Write-Host "`n=== Enable dashboard watchdog scheduled task ==="
$task = Get-ScheduledTask -TaskName $WatchdogName -ErrorAction SilentlyContinue
if ($task) {
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Set-ScheduledTask -TaskName $WatchdogName -Settings $settings | Out-Null
    Enable-ScheduledTask -TaskName $WatchdogName | Out-Null
    Write-Host "Enabled existing task: $WatchdogName"
} else {
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
    $trigger.Repetition = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 2) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask `
        -TaskName $WatchdogName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description 'Checks the AiTradingAgent dashboard and restarts only the dashboard PM2 app if it is down.' | Out-Null
    Write-Host "Created task: $WatchdogName"
}

Write-Host "`n=== Current dashboard status ==="
pm2 describe dashboard | Select-String 'status|uptime|restart|pid'

Write-Host "`nDashboard URL: http://localhost:3001"
