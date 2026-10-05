# who_launched_what_2026-10-03.ps1 -- READ-ONLY. For every node/python/powershell/cmd/freqtrade/ollama process started since $Since,
# walk its parent chain and say who launched it:
#   ME   = descends from the Desktop Commander MCP server (the tool I use to run commands on this PC)
#   PM2  = descends from the PM2 daemon (the 5 demo apps I started with START-DEMO.ps1, plus the ledger-sync cron)
#   TASK = descends from Task Scheduler / svchost (e.g. the existing AiTradingAgent Watchdog task)
#   USER/OTHER = anything else (your own windows, other apps)
param([string]$Since = '20:40')
$cut = [datetime]::Parse((Get-Date -Format 'yyyy-MM-dd') + ' ' + $Since)
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
function Chain($pid0) {
  $names = @(); $cur = $byId[[int]$pid0]; $guard = 0
  while ($cur -and $guard -lt 12) { $names += ("{0}({1})" -f $cur.Name, $cur.ProcessId); $cur = $byId[[int]$cur.ParentProcessId]; $guard++ }
  return $names
}
$mcp = $all | Where-Object { $_.CommandLine -match 'desktop-commander' -and $_.Name -eq 'node.exe' } | Select-Object -ExpandProperty ProcessId
$pm2 = $all | Where-Object { $_.CommandLine -match 'pm2.lib.Daemon' } | Select-Object -ExpandProperty ProcessId
"Desktop Commander MCP server PID(s): $($mcp -join ', ')   PM2 daemon PID(s): $($pm2 -join ', ')   (started before $Since is shown only if it matches below)"
$rows = foreach ($p in $all) {
  if ($p.Name -notmatch '^(node|python|pythonw|powershell|pwsh|cmd|freqtrade|ollama|ollama app)\.exe$') { continue }
  if (-not $p.CreationDate -or $p.CreationDate -lt $cut) { continue }
  if ($p.ProcessId -eq $PID) { continue }
  $chain = Chain $p.ProcessId
  $ids = $chain | ForEach-Object { if ($_ -match '\((\d+)\)') { [int]$Matches[1] } }
  $origin = if ($ids | Where-Object { $mcp -contains $_ }) { 'ME' } elseif ($ids | Where-Object { $pm2 -contains $_ }) { 'PM2' } elseif ($chain -match 'svchost|taskeng|taskhostw') { 'TASK' } else { 'USER/OTHER' }
  $cl = $p.CommandLine; if (-not $cl) { $cl = '' }; if ($cl.Length -gt 95) { $cl = $cl.Substring(0,95) }
  [pscustomobject]@{ Origin = $origin; PID = $p.ProcessId; Started = $p.CreationDate.ToString('HH:mm:ss'); Name = $p.Name; Cmd = $cl; Parent = ($chain | Select-Object -Skip 1 -First 2) -join ' < ' }
}
$rows | Sort-Object Origin, Started | Format-Table -AutoSize -Wrap | Out-String -Width 250
"counts:"; $rows | Group-Object Origin | ForEach-Object { "  {0}: {1}" -f $_.Name, $_.Count }
"--- anything NOT from me or PM2:"
$rows | Where-Object { $_.Origin -notin 'ME','PM2' } | Format-Table -AutoSize -Wrap | Out-String -Width 250
"--- scheduled tasks / startup items that mention this project (all pre-existing unless listed in the change notes)"
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'aitrading|ollama|hermes' } | ForEach-Object { "  task: {0} [{1}]  created/registered {2}" -f $_.TaskName, $_.State, $_.Date }
"PM2 saved dump (what restarts at login via the existing HKCU Run 'PM2' entry):"
pm2 jlist 2>$null | ConvertFrom-Json | ForEach-Object { "  " + $_.name + " (" + $_.pm2_env.status + ")" }
