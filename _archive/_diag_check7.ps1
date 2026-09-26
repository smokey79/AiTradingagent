Write-Host '=== Installer PID 28004 still running? ==='
Get-Process -Id 28004 -ErrorAction SilentlyContinue

Write-Host '=== llama-server search ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length

Write-Host '=== Ollama program dir size/count ==='
$items = Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -ErrorAction SilentlyContinue
Write-Host "File count: $($items.Count)"
Write-Host "Total size MB: $([math]::Round(($items | Measure-Object Length -Sum).Sum/1MB,1))"
