$ErrorActionPreference = 'Stop'

Write-Host "== Stopping any running Ollama processes =="
Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'

Write-Host "== Downloading latest Ollama installer to $installerPath =="
Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $installerPath -UseBasicParsing

$sizeMB = [math]::Round((Get-Item $installerPath).Length / 1MB, 2)
Write-Host "== Downloaded installer size: $sizeMB MB =="

Write-Host "== Running silent install/repair (this reinstalls over the existing broken copy) =="
$proc = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
Write-Host "== Installer exit code: $($proc.ExitCode) =="

Start-Sleep -Seconds 5
