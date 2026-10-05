$task = Get-ScheduledTask -TaskName 'AiTradingAgent Watchdog'
$action = $task.Actions[0]
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
Set-ScheduledTask -TaskName 'AiTradingAgent Watchdog' -Trigger $trigger -Action $action
Write-Host "Updated. New interval:"
(Get-ScheduledTask -TaskName 'AiTradingAgent Watchdog').Triggers[0].Repetition.Interval
