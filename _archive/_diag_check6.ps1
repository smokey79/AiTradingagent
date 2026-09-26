Write-Host '=== Installer PID 14716 still running? ==='
Get-Process -Id 14716 -ErrorAction SilentlyContinue

Write-Host '=== Install log tail ==='
$logPath = Join-Path $env:TEMP 'ollama_install_log.txt'
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 20
} else {
    Write-Host "No log file yet at $logPath"
}

Write-Host '=== llama-server search ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length

Write-Host '=== Top-level Ollama dir now ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime
