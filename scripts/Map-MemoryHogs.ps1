$out = "F:\aitradingagent\logs\memory-hogs.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

# Map PM2 pids to names
$json = pm2 jlist | Out-String
$json | Out-File "F:\aitradingagent\logs\pm2-jlist-now.json" -Encoding utf8

"--- top 25 processes on the whole machine by memory ---" | Out-File $out -Append -Encoding utf8
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 `
  Id, ProcessName, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} |
  Format-Table -AutoSize | Out-File $out -Append -Encoding utf8

"--- process count by name (top 15) ---" | Out-File $out -Append -Encoding utf8
Get-Process | Group-Object ProcessName | Sort-Object Count -Descending | Select-Object -First 15 Count, Name |
  Format-Table -AutoSize | Out-File $out -Append -Encoding utf8

"--- total memory used by each process NAME (grouped, top 15) ---" | Out-File $out -Append -Encoding utf8
Get-Process | Group-Object ProcessName | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    Count = $_.Count
    TotalMB = [math]::Round((($_.Group | Measure-Object WorkingSet64 -Sum).Sum)/1MB,1)
  }
} | Sort-Object TotalMB -Descending | Select-Object -First 15 |
  Format-Table -AutoSize | Out-File $out -Append -Encoding utf8
