$body = @{ model = 'hermes3'; prompt = 'Say OK'; stream = $false } | ConvertTo-Json
try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
    $sw.Stop()
    Write-Host "Response: $($resp.response)"
    Write-Host "Took: $($sw.Elapsed.TotalSeconds) seconds"
} catch {
    Write-Host "FAILED: $($_.Exception.Message)"
}

Write-Host '--- RAM after load ---'
Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Select-Object Name, Id, @{n='WS_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}}
