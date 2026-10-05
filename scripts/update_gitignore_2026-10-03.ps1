# update_gitignore_2026-10-03.ps1 -- adds the new runtime files to .gitignore (idempotent; no BOM).
$p = 'F:\aitradingagent\.gitignore'
$raw = [System.IO.File]::ReadAllText($p)
if ($raw -match 'CALIBRATION 2026-10-03') { "already present"; return }
$add = @(
  '',
  '# --- CALIBRATION 2026-10-03: runtime files, caches and local backups (never commit) ---',
  'data/ledger.db-wal',
  'data/ledger.db-shm',
  'data/exchange_limits.json',
  'backups/',
  'logs/*.txt',
  'freqtrade-stable/*.sqlite-wal',
  'freqtrade-stable/*.sqlite-shm'
) -join "`r`n"
[System.IO.File]::WriteAllText($p, $raw.TrimEnd() + "`r`n" + $add + "`r`n", (New-Object System.Text.UTF8Encoding $false))
"added $(($add -split "`r`n").Count - 2) ignore rules"
