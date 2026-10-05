# ADD-BIGDATA-ENV.ps1 - backs up .env, then adds a blank BIGDATA_API_KEY line if missing (never prints values)
$envFile = 'F:\aitradingagent\.env'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $envFile "$envFile.bak-$stamp"
if (-not (Select-String -Path $envFile -Pattern '^\s*BIGDATA_API_KEY' -Quiet)) {
  try {
    Add-Content -Path $envFile -Value "`r`n# --- Bigdata.com (paste key after the = sign, no quotes) ---`r`nBIGDATA_API_KEY=`r`n" -ErrorAction Stop
    Write-Output "Added blank BIGDATA_API_KEY line to .env (backup: .env.bak-$stamp)"
  } catch { Write-Output ".env is locked by a running bot (PM2?). Stop it (STOP-PM2-BOT.bat) and re-run this script." }
} else { Write-Output "BIGDATA_API_KEY already present in .env" }
Remove-Item 'F:\aitradingagent\_diag_bigdata_env.ps1' -ErrorAction SilentlyContinue
