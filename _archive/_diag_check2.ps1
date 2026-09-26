Write-Host '=== Running processes matching Ollama/Setup ==='
Get-Process | Where-Object { $_.Name -match 'Ollama|Setup' } | Select-Object Name, Id, StartTime

Write-Host '=== llama-server search in Program Files Ollama dir ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length

Write-Host '=== Top-level contents of Ollama program dir now ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime
