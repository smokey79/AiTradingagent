# check_env_shape_2026-10-03.ps1 -- READ-ONLY, no values printed. Is .env still well-formed after the fill? (no stray bare-value lines, filled names non-empty)
$i = 0; $odd = @()
Get-Content F:\aitradingagent\.env | ForEach-Object { $i++; if ($_ -notmatch '^\s*($|#|[A-Za-z_][A-Za-z0-9_.]*\s*=)') { $odd += ("line {0} (length {1})" -f $i, $_.Length) } }
"lines that are not blank / comment / KEY=value: " + $odd.Count + $(if ($odd.Count) { "  -> " + ($odd -join '; ') } else { '' })
$vals = @{}; Get-Content F:\aitradingagent\.env | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_.]*)=(.*)$') { $vals[$Matches[1]] = $Matches[2] } }
foreach ($n in 'CLAUDE_API_KEY', 'ANTHROPIC_API_KEY', 'ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'WEBHOOK_PASSPHRASE', 'YOUTUBE_API_KEY', 'YOUTUBE_CLIENT_ID', 'DEEPSEEK_API_KEY', 'OPENROUTER_API_KEY') { "{0,-20} value length {1}" -f $n, $(if ($vals.ContainsKey($n)) { $vals[$n].Length } else { 'MISSING' }) }
"RISK_MIN_WIN_RATE_GATE in .env (unchanged, live gates stay 0.68): " + $vals['RISK_MIN_WIN_RATE_GATE'] + " | LIVE_GATE_WIN_RATE set in .env: " + $vals.ContainsKey('LIVE_GATE_WIN_RATE')
"total lines: $i"
