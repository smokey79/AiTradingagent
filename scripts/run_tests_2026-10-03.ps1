# run_tests_2026-10-03.ps1 -- runs the project's JS test suite and Python tests, saving output.
# Usage: -Tag before|after
param([string]$Tag = 'before')
$root = 'F:\aitradingagent'
Set-Location $root
$out = "$root\logs\tests_${Tag}_2026-10-03.txt"
"=== JS: node tests/runAllTests.js  ($Tag) $(Get-Date -Format s)" | Set-Content $out
node tests/runAllTests.js 2>&1 | Add-Content $out
"=== exit code: $LASTEXITCODE" | Add-Content $out
"=== Python: pytest tests (quiet) ($Tag)" | Add-Content $out
& "$root\.venv\Scripts\python.exe" -m pytest tests -q -x --no-header -p no:cacheprovider 2>&1 | Select-Object -Last 40 | Add-Content $out
"=== done" | Add-Content $out
"wrote $out"
