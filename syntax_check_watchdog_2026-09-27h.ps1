$errors = $null
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content "F:\aitradingagent\scripts\Watchdog.ps1" -Raw), [ref]$errors)
if ($errors.Count -eq 0) { Write-Output "SYNTAX_OK" } else { $errors | ForEach-Object { Write-Output $_.Message } }
