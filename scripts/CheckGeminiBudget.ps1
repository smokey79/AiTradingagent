Write-Host "=== Gemini call tracker files ==="
Get-ChildItem "F:\aitradingagent\data" -Filter "*gemini*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "$($_.Name)  LastWrite=$($_.LastWriteTime)"
    Get-Content $_.FullName -Raw
}
Write-Host ""
Write-Host "=== Current server time (Windows) ==="
Get-Date
Get-Date -AsUTC
Write-Host ""
Write-Host "=== Gemini call lines across all PM2 logs today ==="
pm2 logs --lines 2000 --nostream | Select-String "Gemini Agent.*(call|budget|Making real API call)" | Select-Object -First 40
