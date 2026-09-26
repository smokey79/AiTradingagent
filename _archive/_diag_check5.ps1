Write-Host '=== Is installer (PID 26484) still running? ==='
Get-Process -Id 26484 -ErrorAction SilentlyContinue

Write-Host '=== llama-server search ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length

Write-Host '=== Top-level Ollama dir ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime

Write-Host '=== lib dir ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama\lib' -Recurse -ErrorAction SilentlyContinue |
    Select-Object FullName | Select-Object -First 30
