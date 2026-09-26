$ErrorActionPreference = 'Stop'

Write-Host '=== Killing any leftover ollama/setup processes ==='
Get-Process -Name 'ollama*','OllamaSetup' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
if (Test-Path $installerPath) {
    Remove-Item $installerPath -Force
    Write-Host "Removed old installer file."
}

Write-Host '=== Fresh download ==='
Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $installerPath -UseBasicParsing
$item = Get-Item $installerPath
Write-Host "New file size: $($item.Length) bytes"
$hash = Get-FileHash -Path $installerPath -Algorithm SHA256
Write-Host "SHA256: $($hash.Hash)"
