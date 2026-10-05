try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 -UseBasicParsing
  Write-Output ("OLLAMA_HTTP_STATUS=" + $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("OLLAMA_UNREACHABLE: " + $_.Exception.Message)
}
Write-Output "--- ollama processes ---"
Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Select-Object Name, Id | Format-Table -AutoSize
Write-Output "--- env vars ---"
Write-Output ("OLLAMA_URL=" + $env:OLLAMA_URL)
Write-Output ("OLLAMA_HOST=" + $env:OLLAMA_HOST)
Write-Output ("OLLAMA_MODEL=" + $env:OLLAMA_MODEL)
