$ErrorActionPreference = 'Stop'
try {
  $resp = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/models' -Method Get -TimeoutSec 15
  $free = $resp.data | Where-Object { $_.id -match 'deepseek' }
  Write-Output "=== All DeepSeek-family models currently on OpenRouter ==="
  $free | Select-Object id, @{n='prompt_price';e={$_.pricing.prompt}}, @{n='completion_price';e={$_.pricing.completion}} | Format-Table -AutoSize
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
