param([switch]$Apply, [switch]$CloseTerminals)
$ErrorActionPreference = 'Stop'
$tradingRootPattern = '(?i)F:[/\\](aitrader|aitradingagent2?)([/\\]|\b)'
$knownAppPattern = '^(ai-trading-bot|fastapi|flask-dashboard|trading-api|trading-dashboard|trading-orchestrator|dashboard|freqtrade-bridge|bigdata-analyst|telegram-listener|ledger-sync|arb-agent|arb-scanner|python-debate|hermes-analyst|tradingkit-analyst|mt5-feed|claude-solo|prediction-expert|risk-gate|trading-data|portfolio-manager|aitradingagent1|aitradingagent2)(-\d+)?$'
$workerNames = @('node.exe','python.exe','pythonw.exe','freqtrade.exe')
$runtimePattern = '(?i)([/\\]src[/\\](orchestrator|arb|arbitrage|dashboard|notifications|control)[/\\]|[/\\]scripts[/\\](mt5_|debate|bigdata|hermes|ledger_|prediction_|train_prediction)|[/\\](index\.js|wsgi\.py|flashloan_scanner\.py)|freqtrade|ProcessContainerFork\.js)'
$taskPm2Home = if ($env:PM2_HOME) { $env:PM2_HOME } else { Join-Path $env:USERPROFILE '.pm2' }
$processes = @(Get-CimInstance Win32_Process)
$preserveIds = [System.Collections.Generic.HashSet[int]]::new()
$ancestorId = $PID
while ($ancestorId -gt 0 -and $preserveIds.Add($ancestorId)) {
  $ancestor = $processes | Where-Object ProcessId -eq $ancestorId | Select-Object -First 1
  if (-not $ancestor) { break }
  $ancestorId = [int]$ancestor.ParentProcessId
}
$taskNames = @()
try {
  $taskNames = @(Get-ScheduledTask | Where-Object {
    $_.TaskName -match '(?i)aitrad|trading.*watchdog' -or
    (($_.Actions | ForEach-Object { $_.Arguments }) -join ' ') -match $tradingRootPattern
  })
} catch { Write-Output 'Scheduled task inspection unavailable.' }
$targetIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($p in $processes) {
  if ($p.Name -in $workerNames -and $p.CommandLine -match $tradingRootPattern -and $p.CommandLine -match $runtimePattern -and -not $preserveIds.Contains([int]$p.ProcessId)) { [void]$targetIds.Add([int]$p.ProcessId) }
}
$pidFiles = @()
$pidDir = Join-Path $taskPm2Home 'pids'
if (Test-Path -LiteralPath $pidDir) { $pidFiles = @(Get-ChildItem -LiteralPath $pidDir -Filter '*.pid') }
foreach ($file in $pidFiles) {
  $appName = $file.BaseName -replace '-\d+$',''
  if ($appName -match $knownAppPattern) {
    $taskWorkerId = 0
    if ([int]::TryParse((Get-Content -LiteralPath $file.FullName -Raw).Trim(), [ref]$taskWorkerId)) {
      $taskWorker = $processes | Where-Object ProcessId -eq $taskWorkerId | Select-Object -First 1
      if ($taskWorker.Name -in $workerNames -and ($taskWorker.CommandLine -match $tradingRootPattern -or $taskWorker.CommandLine -match 'ProcessContainerFork\.js')) { [void]$targetIds.Add($taskWorkerId) }
    }
  }
}
$daemonFile = Join-Path $taskPm2Home 'pm2.pid'
$taskDaemonId = 0
if (Test-Path -LiteralPath $daemonFile) { [void][int]::TryParse((Get-Content -LiteralPath $daemonFile -Raw).Trim(), [ref]$taskDaemonId) }
$allManagedTrading = $pidFiles.Count -gt 0 -and @($pidFiles | Where-Object { ($_.BaseName -replace '-\d+$','') -notmatch $knownAppPattern }).Count -eq 0
if ($allManagedTrading -and $taskDaemonId -gt 0) { [void]$targetIds.Add($taskDaemonId) }
# Descendants include Python broker/feed workers launched from a trading process.
do {
  $changed = $false
  foreach ($p in $processes) {
    if ($targetIds.Contains([int]$p.ParentProcessId) -and $p.Name -in ($workerNames + @('conhost.exe','cmd.exe')) -and -not $preserveIds.Contains([int]$p.ProcessId)) { if ($targetIds.Add([int]$p.ProcessId)) { $changed = $true } }
  }
} while ($changed)
$targets = @($processes | Where-Object { $targetIds.Contains([int]$_.ProcessId) -and -not $preserveIds.Contains([int]$_.ProcessId) })
$targets | Select-Object @{Name='Target';Expression={'trading process'}},ProcessId,Name
$taskNames | Select-Object TaskName,State,@{Name='Enabled';Expression={$_.Settings.Enabled}}
Write-Output "PM2 managed files: $($pidFiles.Count); all recognised trading apps: $allManagedTrading"
Write-Output "E drive available: $(Test-Path -LiteralPath 'E:\')"
if (-not $Apply) { return }
foreach ($task in $taskNames) {
  try { Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null; Write-Output "Disabled restart task: $($task.TaskName)" } catch { Write-Output "Could not disable restart task: $($task.TaskName)" }
}
# Stop the supervisor first so it cannot respawn the workers.
if ($allManagedTrading -and $taskDaemonId -gt 0) { Stop-Process -Id $taskDaemonId -Force -ErrorAction SilentlyContinue }
foreach ($p in $targets) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($CloseTerminals) {
  Get-Process WindowsTerminal,OpenConsole -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($p in $processes) {
    if ($p.Name -in @('powershell.exe','pwsh.exe','cmd.exe') -and -not $preserveIds.Contains([int]$p.ProcessId)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Write-Output 'Closed standalone terminals and other command shells.'
}
Start-Sleep -Seconds 2
$remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in $workerNames -and $_.CommandLine -match $tradingRootPattern -and $_.CommandLine -match $runtimePattern -and -not $preserveIds.Contains([int]$_.ProcessId) })
$remaining | Select-Object @{Name='Remaining';Expression={'trading process'}},ProcessId,Name
Write-Output "Remaining processes with a trading project path: $($remaining.Count)"
