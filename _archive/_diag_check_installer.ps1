Get-Process -Name 'OllamaSetup','ollama','ollama app' -ErrorAction SilentlyContinue | Select-Object Name, Id

Write-Host '---installer file---'
$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
Get-Item $installerPath -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime

Write-Host '---llama-server search---'
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length
