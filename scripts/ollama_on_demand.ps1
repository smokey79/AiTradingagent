# ollama_on_demand.ps1 (2026-10-03) -- run Ollama only when needed, so it stops holding RAM.
#   -Action Status    show whether Ollama is running, what model is loaded, and the autostart/keep-alive settings
#   -Action Start     start the Ollama server (hidden)
#   -Action Stop      stop the Ollama server (frees the model's RAM)
#   -Action Enable    turn "on demand" on:  OLLAMA_KEEP_ALIVE=2m (user env) + disable the Startup shortcut (moved, not deleted)
#   -Action Disable   undo Enable (restores the shortcut and OLLAMA_KEEP_ALIVE=10m)
# The bot itself now starts/stops Ollama on demand (src/utils/ollamaQueue.js); Enable only stops Windows from
# launching it at every login. Enable/Disable change your user settings, so they are NOT run automatically.
param([ValidateSet('Status','Start','Stop','Enable','Disable')][string]$Action = 'Status')
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$lnk = Join-Path $startup 'Ollama.lnk'
$parked = 'F:\aitradingagent\backups\2026-10-03_precalibration\startup\Ollama.lnk'

function Status {
  "Ollama processes:"; Get-Process | Where-Object { $_.ProcessName -like '*ollama*' } | Select-Object ProcessName,Id,@{n='RAM_MB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String
  try { $ps = Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3; "Loaded models: " + $(if ($ps.models.Count) { ($ps.models | ForEach-Object { "$($_.name) ($([int]($_.size/1MB)) MB)" }) -join ', ' } else { 'none' }) } catch { "Server not reachable (not running)" }
  "OLLAMA_KEEP_ALIVE (user): " + [Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','User')
  "Startup shortcut present: " + (Test-Path $lnk)
}
switch ($Action) {
  'Status'  { Status }
  'Start'   { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep 3; Status }
  'Stop'    { Get-Process | Where-Object { $_.ProcessName -like '*ollama*' } | Stop-Process -Force; "stopped"; Status }
  'Enable'  {
    [Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE','2m','User')
    if (Test-Path $lnk) { New-Item -ItemType Directory -Force -Path (Split-Path $parked) | Out-Null; Move-Item $lnk $parked -Force; "Startup shortcut moved to $parked" }
    "On-demand enabled. Restart Ollama (-Action Stop) so it picks up OLLAMA_KEEP_ALIVE=2m."
  }
  'Disable' {
    [Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE','10m','User')
    if (Test-Path $parked) { Move-Item $parked $lnk -Force; "Startup shortcut restored" }
    "On-demand disabled (autostart restored, keep-alive back to 10m)."
  }
}
