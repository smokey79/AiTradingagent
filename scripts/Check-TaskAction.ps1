$out = "F:\aitradingagent\logs\task-action-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
$t = Get-ScheduledTask -TaskName 'AiTradingAgent Watchdog'
"--- Actions ---" | Out-File $out -Append -Encoding utf8
$t.Actions | Format-List * | Out-File $out -Append -Encoding utf8
"--- Triggers ---" | Out-File $out -Append -Encoding utf8
$t.Triggers | Format-List * | Out-File $out -Append -Encoding utf8
"--- Settings ---" | Out-File $out -Append -Encoding utf8
$t.Settings | Format-List * | Out-File $out -Append -Encoding utf8
