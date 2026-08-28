# ================================
# AiTradingAgent Python Module Checker
# ================================

$root = "F:\aitradingagent\python-modules"

$modules = @(
    "sopr_mvrv.py",
    "peer_rotation.py",
    "relative_strength.py",
    "volatility_regimes.py"
)

Write-Host "`n=== Python Module Checker ===`n" -ForegroundColor Cyan

foreach ($m in $modules) {
    $path = "$root\$m"

    if (Test-Path $path) {
        Write-Host "[OK] $m" -ForegroundColor Green
    } else {
        Write-Host "[MISSING] $m -> creating placeholder..." -ForegroundColor Yellow
        New-Item -ItemType File -Path $path | Out-Null
    }
}

Write-Host "`nPython module check complete.`n" -ForegroundColor Cyan
