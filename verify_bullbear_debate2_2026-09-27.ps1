$ErrorActionPreference = "Continue"
Set-Location "F:\aitradingagent"
$files = @(
  "src\utils\ollamaQueue.js",
  "src\agents\bullDebateAgent.js",
  "src\agents\bearDebateAgent.js",
  "src\agents\riskManagerDebateAgent.js",
  "src\agents\metaEvaluatorAgent.js",
  "src\agents\openrouterFreeAgent.js",
  "src\agents\hermesAgent.js",
  "src\orchestrator\consensus.js"
)
$allOk = $true
foreach ($f in $files) {
  node --check $f
  if ($LASTEXITCODE -eq 0) {
    Write-Output "OK: $f"
  } else {
    Write-Output "FAIL: $f"
    $allOk = $false
  }
}
if ($allOk) {
  Write-Output "ALL_CHECKS_PASSED"
} else {
  Write-Output "SOME_CHECKS_FAILED"
}
