Write-Host '=== All processes with CommandLine mentioning Ollama or Temp exe ==='
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Ollama' -or $_.Name -match 'Ollama' } |
    Select-Object ProcessId, Name, CommandLine | Format-List

Write-Host '=== Check llama-server again ==='
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -Recurse -Filter '*llama-server*' -ErrorAction SilentlyContinue |
    Select-Object FullName, Length
