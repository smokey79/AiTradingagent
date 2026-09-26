$ErrorActionPreference = 'Stop'
Set-Location F:\aitradingagent

Write-Host '=== 1. Remove this session own scratch diagnostic scripts (git-cleanup helpers, no ongoing value) ==='
$scratch = @(
  'scripts\_find_bridge_fast.ps1','scripts\_find_pm2_and_bridge.ps1','scripts\_git_cleanup_and_commit.ps1',
  'scripts\_investigate_repo_state.ps1','scripts\_investigate_repo_state2.ps1','scripts\_investigate_secrets_and_bridge.ps1',
  'scripts\_secret_scan_staged.ps1','scripts\_pm2_jlist.json'
)
foreach ($f in $scratch) { Remove-Item $f -ErrorAction SilentlyContinue; Write-Host "removed $f" }

Write-Host ''
Write-Host '=== 2. Re-add .gitignore, verify noise patterns now match ==='
git add .gitignore
git check-ignore -v _diag_final.ps1
git check-ignore -v mcp-servers/risk-gate-mcp/index.js.bak
git check-ignore -v tools/apache-maven-3.9.16/bin/mvn

Write-Host ''
Write-Host '=== 3. Stage everything else (gitignore now filters the noise) ==='
git add -A
$staged = git diff --cached --name-only
Write-Host "Files about to be committed: $($staged.Count)"

Write-Host ''
Write-Host '=== 4. Secret-pattern scan of THIS new staged diff before committing ==='
git diff --cached -U0 > scripts\_tmp_diff.txt
$patterns = 'sk-ant-api03-[A-Za-z0-9_-]{20,}','sk-proj-[A-Za-z0-9_-]{20,}','sk-[A-Za-z0-9]{32,}','AIzaSy[A-Za-z0-9_-]{20,}','ghp_[A-Za-z0-9]{30,}','AKIA[A-Z0-9]{12,}','xox[baprs]-[A-Za-z0-9-]{10,}'
$hits = 0
foreach ($p in $patterns) { $m = Select-String -Path scripts\_tmp_diff.txt -Pattern $p; $hits += $m.Count; if ($m.Count -gt 0) { Write-Host "PATTERN HIT: $p ($($m.Count))" } }
Write-Host "Total secret-pattern hits: $hits"
Remove-Item scripts\_tmp_diff.txt -ErrorAction SilentlyContinue

if ($hits -eq 0) {
  git commit -m "feat: OANDA/T212 broker groundwork, MTF/top50 research tooling, pybacktest engine

New broker connectors (src/brokers/oandaBroker.js, trading212Broker.js)
with offline tests and standalone connectivity-check scripts
(scripts/oanda_check.js, t212_check.js) - not yet wired into the live
consensus orchestrator. Alpaca paper-key connectivity check
(test_alpaca.py, read-only, places no orders).

New pybacktest/ offline backtesting engine, multi-timeframe/top-50
universe research scripts, allocation and evidence-candidate agents,
technical_mtf agent, wallet module, and assorted ops scripts
(RestartBot.ps1, Watchdog.ps1, ConfigureAlwaysOn.ps1, Set-EnvValue.ps1).

.gitignore hardened further: AI-tool state dirs, *.bak clutter,
vendored build tools (tools/apache-maven, tools/*/target), and
regenerable OHLCV downloads are now excluded from version control." 2>&1 | Select-Object -Last 10
} else {
  Write-Host 'ABORTED COMMIT: secret pattern matched - needs manual review before committing.'
}

Write-Host ''
Write-Host '=== 5. Final state ==='
git log --oneline -6
git status --short | Measure-Object | Select-Object -ExpandProperty Count
