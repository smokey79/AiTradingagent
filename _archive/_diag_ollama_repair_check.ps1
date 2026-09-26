Get-PSDrive -PSProvider FileSystem | Select-Object Name,
    @{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}},
    @{n='UsedGB';e={[math]::Round($_.Used/1GB,2)}}

Write-Host '---winget---'
try { winget --version } catch { Write-Host "winget not available: $_" }

Write-Host '---ollama install dir listing (top level)---'
Get-ChildItem -Path 'C:\Users\barcl\AppData\Local\Programs\Ollama' -ErrorAction SilentlyContinue |
    Select-Object Name, Length, Mode
