# repair_env_2026-10-03.ps1 -- the first master-env apply wrote one empty-value fill (CLAUDE_API_KEY=) onto the NEXT line (greedy-whitespace bug, now fixed + tested).
# This puts back the exact pre-apply .env from the backup (keeping the faulty one aside), then re-applies with the fixed script.
$bdir = 'F:\aitradingagent\backups\2026-10-03_master_env'
$bak = Get-ChildItem $bdir -Filter '.env.before-*' | Sort-Object LastWriteTime | Select-Object -First 1   # the OLDEST backup = the untouched original
"restoring from: " + $bak.Name + " (" + $bak.Length + " B)"
Copy-Item 'F:\aitradingagent\.env' (Join-Path $bdir '.env.faulty-apply-225719') -Force
Copy-Item $bak.FullName 'F:\aitradingagent\.env' -Force
"restored .env: " + (Get-Item 'F:\aitradingagent\.env').Length + " B"
& 'F:\aitradingagent\scripts\master_env_apply_2026-10-03.ps1'
