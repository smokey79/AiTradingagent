# who_is_llama_2026-10-03.ps1 -- READ-ONLY. Which process is using 3+ GB of RAM as "llama-server", who started it, and is Ollama up?
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
function Chain($id) { $o = @(); $c = $byId[[int]$id]; $g = 0; while ($c -and $g -lt 10) { $o += ("{0}({1}) started {2}" -f $c.Name, $c.ProcessId, $(if ($c.CreationDate) { $c.CreationDate.ToString('HH:mm:ss') } else { '?' })); $c = $byId[[int]$c.ParentProcessId]; $g++ }; $o }
foreach ($p in ($all | Where-Object { $_.Name -match 'llama|ollama' })) {
  "--- {0} PID {1}  RAM {2:N0} MB  started {3}" -f $p.Name, $p.ProcessId, ((Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 / 1MB), $p.CreationDate
  "    cmd: " + $(if ($p.CommandLine) { $p.CommandLine.Substring(0, [Math]::Min(230, $p.CommandLine.Length)) } else { '(none)' })
  "    chain: " + ((Chain $p.ProcessId) -join '  <  ')
}
"--- Ollama API:"
try { (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 5).models | ForEach-Object { "  loaded model: {0}  size {1:N1} GB  expires {2}" -f $_.name, ($_.size / 1GB), $_.expires_at } } catch { "  Ollama API not answering: " + $_.Exception.Message }
"--- recent orchestrator Ollama on-demand lines:"
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 3000 | Select-String -Pattern 'ollama' -SimpleMatch -CaseSensitive:$false | Select-Object -Last 6 | ForEach-Object { "  " + $_.Line.Trim() }
