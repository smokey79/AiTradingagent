# env_check_2026-10-03.ps1 -- READ-ONLY. Shows NON-SECRET tuning keys in .env (values printed only for the allow-list below).
$allow = 'ROUND_TRIP_COST_PCT','MIN_ORDER_USD','LIVE_GATE_WIN_RATE','LIVE_GATE_MIN_TRADES','RISK_GATE_MIN_TRADES','RISK_MIN_WIN_RATE_GATE',
  'EVIDENCE_MIN_TRADES','EVIDENCE_MIN_PF','EVIDENCE_MIN_OOS_PF','EVIDENCE_MAX_DD_PCT','EVIDENCE_REQUIRE_OOS','INITIAL_DEPOSIT','LEVERAGE_CAP',
  'ALLOCATION_DEFAULT_PCT','ALLOCATION_MEME_PCT','AUTO_TRADE_INTERVAL_SEC','PAPER_TRADE_MODE','ARB_MODE','ALLOW_SYNTHETIC_CANDLES',
  'MIN_CONFIDENCE','CONSENSUS_MIN_CONFIDENCE','MIN_AGENTS','CONSENSUS_MIN_AGENTS_AGREEING','NO_TRADES','EXECUTION_ENABLED','BASE_ACCOUNT_CURRENCY',
  'OLLAMA_KEEP_ALIVE','HERMES_ANALYSIS_INTERVAL_S','BIGDATA_REFRESH_INTERVAL_S','KELLY_FRACTION','VALIDATED_AGENTS','DUEL_HOURS','CLAUDE_MODEL','PRIMARY_MODEL'
$found = @{}
Get-Content F:\aitradingagent\.env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k = ($_ -split '=',2)[0].Trim(); $v = ($_ -split '=',2)[1].Trim()
  if ($allow -contains $k) { $found[$k] = $v }
}
foreach ($k in $allow) { if ($found.ContainsKey($k)) { "{0,-34} = {1}" -f $k, $found[$k] } else { "{0,-34}   (not set)" -f $k } }
"--- already contains calibration block?"
(Select-String -Path F:\aitradingagent\.env -Pattern 'CALIBRATION 2026-10-03' -Quiet)
