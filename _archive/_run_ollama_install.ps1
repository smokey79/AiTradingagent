$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
if (-not (Test-Path $installerPath)) {
    Write-Host "ERROR: installer not found at $installerPath"
    exit 1
}
Write-Host "Launching silent installer (detached, not waiting)..."
Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host "Launched. Check back in a minute."
