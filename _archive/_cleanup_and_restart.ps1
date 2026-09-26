Write-Host '=== Cleaning up 1.5GB installer from Temp ==='
Remove-Item (Join-Path $env:TEMP 'OllamaSetup.exe') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:TEMP 'ollama_install_log.txt') -Force -ErrorAction SilentlyContinue
Write-Host 'Cleaned.'

Write-Host '=== PM2 status before restart ==='
pm2 list

Write-Host '=== Restarting python-debate and arb-scanner to pick up working Ollama ==='
pm2 restart python-debate arb-scanner

Start-Sleep -Seconds 5
Write-Host '=== PM2 status after restart ==='
pm2 list
