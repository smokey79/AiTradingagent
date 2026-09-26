Write-Host '=== Starting Ollama app (tray/service) ==='
Start-Process -FilePath 'C:\Users\barcl\AppData\Local\Programs\Ollama\ollama app.exe'
Start-Sleep -Seconds 6

Write-Host '=== Processes ==='
Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Select-Object Name, Id

Write-Host '=== ollama list ==='
& 'C:\Users\barcl\AppData\Local\Programs\Ollama\ollama.exe' list

Write-Host '=== Direct API test ==='
try {
    $body = @{ model = 'llama3.2'; prompt = 'Say OK'; stream = $false } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 60
    Write-Host "API response: $($resp.response)"
} catch {
    Write-Host "API test FAILED: $($_.Exception.Message)"
}
