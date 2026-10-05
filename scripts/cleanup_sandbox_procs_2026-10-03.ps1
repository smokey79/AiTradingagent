# cleanup_sandbox_procs_2026-10-03.ps1 -- stops ONLY leftover processes started from my temp test sandboxes (path contains aita_extra_ / aita_sandbox_)
# and removes those temp folders. Does not touch PM2, Ollama or anything else.
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'aita_extra_|aita_sandbox_' -and $_.Name -match 'node|powershell|python' -and $_.ProcessId -ne $PID }
if (-not $procs) { "no leftover sandbox processes" }
foreach ($p in $procs) {
  $cl = $p.CommandLine; if ($cl.Length -gt 150) { $cl = $cl.Substring(0,150) }
  "stopping PID $($p.ProcessId) $($p.Name): $cl"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
Get-ChildItem $env:TEMP -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(aita_extra_|aita_sandbox_|ledgertest-|ledgerdb-|limits-|calib_py_)' } | ForEach-Object {
  cmd /c rmdir "$($_.FullName)\node_modules" 2>$null | Out-Null
  Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  "removed temp folder $($_.Name) (still exists: $(Test-Path $_.FullName))"
}
