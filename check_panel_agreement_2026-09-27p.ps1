Start-Sleep -Seconds 45
Write-Output "=== pm2 status ==="
pm2 list 2>&1 | Out-String

Write-Output "`n=== Master Consensus lines, last 600, tallied by agreeing count ==="
$lines = Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 1500 | Select-String 'Master Consensus:'
$lines | ForEach-Object { $_.Line } | Select-String -Pattern '\((\d+)/(\d+) agents agreeing\)' | Out-Null
$counts = @{}
foreach ($l in $lines) {
  if ($l.Line -match '\((\d+)/(\d+) agents agreeing\)') {
    $key = "$($matches[1])/$($matches[2])"
    if ($counts.ContainsKey($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
  }
}
$counts.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Output "$($_.Name) agreeing: $($_.Value) times" }
Write-Output "Total consensus lines: $($lines.Count)"

Write-Output "`n=== Any BUY/SELL candidates that reached the debate stage? ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 1500 | Select-String 'BullDebate|BearDebate|Debate veto|EXECUT' | Select-Object -Last 15 | ForEach-Object { $_.Line }
