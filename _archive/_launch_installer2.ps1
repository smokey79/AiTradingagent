$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
$logPath = Join-Path $env:TEMP 'ollama_install_log.txt'
if (Test-Path $logPath) { Remove-Item $logPath -Force }

Write-Host "Launching with Inno Setup silent flags, logging to $logPath ..."
$p = Start-Process -FilePath $installerPath `
    -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=`"$logPath`"" `
    -PassThru
Write-Host "Started PID: $($p.Id)"
