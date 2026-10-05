$errors = $null
$tokens = [System.Management.Automation.PSParser]::Tokenize((Get-Content F:\aitradingagent\scripts\Watchdog.ps1 -Raw), [ref]$errors)
if ($errors.Count -eq 0) { Write-Output "SYNTAX OK" } else { $errors }
