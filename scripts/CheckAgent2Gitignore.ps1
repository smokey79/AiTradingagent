Set-Location F:\aitradingagent2
Write-Host "=== .gitignore contents ==="
if (Test-Path .gitignore) { Get-Content .gitignore } else { Write-Host "NO .gitignore FILE" }
Write-Host ""
Write-Host "=== git ls-files matching credential-looking names ==="
git ls-files | Select-String -Pattern "\.env|secrets|API|login" -CaseSensitive:$false
