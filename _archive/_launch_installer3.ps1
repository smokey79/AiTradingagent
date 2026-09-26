$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
Write-Host "File info:"
Get-Item $installerPath | Select-Object FullName, Length

Write-Host "Running with /VERYSILENT and -Wait, capturing exit code..."
$p = Start-Process -FilePath $installerPath -ArgumentList '/VERYSILENT' -Wait -PassThru
Write-Host "Exit code: $($p.ExitCode)"
