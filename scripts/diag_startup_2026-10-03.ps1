# diag_startup_2026-10-03.ps1 -- READ-ONLY diagnosis of the orchestrator start-up crash.
$ErrorActionPreference = 'Continue'
$root = 'F:\aitradingagent'
Set-Location $root
"--- node / npm versions"
node -v
npm -v
"--- dotenv folder"
if (Test-Path "$root\node_modules\dotenv") {
  Get-ChildItem "$root\node_modules\dotenv" | Select-Object Name,Length | Format-Table -AutoSize | Out-String
  "package.json present: " + (Test-Path "$root\node_modules\dotenv\package.json")
} else { "node_modules\dotenv MISSING" }
"--- package.json (type/scripts/deps)"
Get-Content "$root\package.json" -Raw
"--- ecosystem.config.cjs"
Get-Content "$root\ecosystem.config.cjs" -Raw
"--- src\orchestrator files"
Get-ChildItem "$root\src\orchestrator" | Select-Object Name,Length,LastWriteTime | Format-Table -AutoSize | Out-String
"--- orchestrator.js head"
Get-Content "$root\src\orchestrator\orchestrator.js" -TotalCount 40
"--- orchestrator.log (first 14 lines)"
Get-Content "$root\logs\orchestrator.log" -TotalCount 14
"--- free disk"
Get-PSDrive F | Select-Object Used,Free | Format-List | Out-String
