$out = "F:\aitradingagent\logs\aitradingagent2-processes.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

"--- current host memory ---" | Out-File $out -Append -Encoding utf8
$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [math]::Round($os.TotalVisibleMemorySize/1MB,2)
$freeGB  = [math]::Round($os.FreePhysicalMemory/1MB,2)
$usedPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100,1)
"Total: $totalGB GB | Free: $freeGB GB | Used: $usedPct%" | Out-File $out -Append -Encoding utf8

"--- node.exe / python.exe processes whose command line mentions aitradingagent2 ---" | Out-File $out -Append -Encoding utf8
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'aitradingagent2' } |
  ForEach-Object {
    $procMem = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64
    $mb = if ($procMem) { [math]::Round($procMem/1MB,1) } else { "?" }
    "PID=$($_.ProcessId) Mem=${mb}MB Created=$($_.CreationDate) Cmd=$($_.CommandLine)" | Out-File $out -Append -Encoding utf8
  }

"--- ALL node.exe / python.exe processes sorted by memory (top 20) ---" | Out-File $out -Append -Encoding utf8
Get-Process -Name node,python -ErrorAction SilentlyContinue |
  Sort-Object WorkingSet64 -Descending |
  Select-Object -First 20 Id, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}}, StartTime |
  Format-Table -AutoSize | Out-File $out -Append -Encoding utf8

"--- is aitradingagent2 under this same PM2 daemon? (pm2 list already shown separately) ---" | Out-File $out -Append -Encoding utf8
Test-Path 'F:\aitradingagent2\ecosystem.config.cjs' | Out-File $out -Append -Encoding utf8

"--- any scheduled task referencing aitradingagent2 ---" | Out-File $out -Append -Encoding utf8
Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
  $actions = (Get-ScheduledTaskInfo -TaskName $_.TaskName -ErrorAction SilentlyContinue)
  $a = $_.Actions | Where-Object { $_.Arguments -match 'aitradingagent2' -or $_.Execute -match 'aitradingagent2' }
  if ($a) { "$($_.TaskName): $($a.Execute) $($a.Arguments)" | Out-File $out -Append -Encoding utf8 }
}
