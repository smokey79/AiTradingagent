$pm2Pids = @(32340,19540,18204,20456,9420,25664,31852,11056,11252,22496,35336)
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" |
  Where-Object { $pm2Pids -notcontains $_.ProcessId } |
  Select-Object ProcessId, Name, CreationDate, @{N='CmdLine';E={$_.CommandLine}} |
  Sort-Object CreationDate |
  Format-Table -AutoSize -Wrap
