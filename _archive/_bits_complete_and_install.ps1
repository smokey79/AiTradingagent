$ErrorActionPreference = 'Stop'

Write-Host '=== Completing BITS job ==='
$job = Get-BitsTransfer | Where-Object { $_.JobId -eq '75832f32-556c-48db-970e-21a32fee2516' }
if ($job) {
    Complete-BitsTransfer -BitsJob $job
    Write-Host "Completed."
} else {
    Write-Host "Job not found (may already be completed)."
}

Write-Host '=== Removing stale error job ==='
Get-BitsTransfer | Where-Object { $_.JobState -eq 'Error' } | Remove-BitsTransfer -ErrorAction SilentlyContinue

$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
$item = Get-Item $installerPath
Write-Host "Final file: $($item.FullName), size: $($item.Length) bytes"

Write-Host '=== Killing any ollama processes before install ==='
Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host '=== Launching installer /VERYSILENT (detached, not waiting) ==='
$p = Start-Process -FilePath $installerPath -ArgumentList '/VERYSILENT' -PassThru
Write-Host "Started PID: $($p.Id)"
