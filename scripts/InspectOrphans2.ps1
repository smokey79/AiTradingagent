$pm2Pids = @(8100,19540,26320,35336,20304,35460,25664,31852,11056,15760,22496)
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" |
  Where-Object { $pm2Pids -notcontains $_.ProcessId } |
  Where-Object { $_.CommandLine -match 'aitradingagent' } |
  Select-Object ProcessId, Name, CreationDate, @{N='CmdLine';E={$_.CommandLine}} |
  Sort-Object CreationDate |
  Format-Table -AutoSize -Wrap
