$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
Write-Host "Launching $installerPath silently (detached)..."
$p = Start-Process -FilePath $installerPath -ArgumentList '/S' -PassThru
Write-Host "Started PID: $($p.Id)"
