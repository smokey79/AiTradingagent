$ErrorActionPreference = 'Stop'
$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'

if (Test-Path $installerPath) {
    Remove-Item $installerPath -Force
    Write-Host "Removed stale/partial installer file."
}

Write-Host "Starting BITS transfer (resilient to network drops)..."
Import-Module BitsTransfer -ErrorAction SilentlyContinue
Start-BitsTransfer -Source 'https://ollama.com/download/OllamaSetup.exe' -Destination $installerPath -Asynchronous

Write-Host "BITS job started."
Get-BitsTransfer | Select-Object JobId, JobState, BytesTransferred, BytesTotal
