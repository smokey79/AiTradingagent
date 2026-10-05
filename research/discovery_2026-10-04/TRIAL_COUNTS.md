# Trial counts and effective settings

18,755 candidate runs contain 13,032 distinct effective settings; 5,723 runs repeat an effective combination. Distinct settings remain correlated. The final selection retains one validation-chosen representative per family, so repeated combinations cannot populate the15 ranks.

|Family|Candidate runs|Distinct effective settings|
|---|---:|---:|
|anchored_vwap|795|421|
|btc_lead_lag|790|466|
|channel_retest|796|412|
|compression_breakout|796|564|
|efficiency_momentum|791|601|
|engulfing_pullback|790|543|
|exhaustion_reversal|791|445|
|funding_crowd_fade|891|891|
|funding_settlement_breakout|1009|1009|
|inside_bar|794|411|
|mtf_pullback|793|695|
|obv_divergence|783|421|
|prior_ema_baseline|793|670|
|range_reclaim|791|422|
|range_zscore|790|620|
|relative_strength|790|605|
|rsi2_trend|789|597|
|session_breakout|790|403|
|sign_reversal_costfilter|1020|1020|
|three_bar_reversal|792|405|
|trendline_break|792|405|
|volatility_drift|796|621|
|volume_climax|793|385|

Unused parameters are excluded from this audit. For example, the session-breakout rule uses a fixed07–16 UTC window and fixed1.5× volume filter; changing fast EMA does not change its entry condition. Stops, target ratios, holding limits, side restrictions, timeframe and sizing still change its effective strategy. This audit does not claim an effective number of independent trials or a formal selection-adjusted significance level.

The final timed worker logged 9,206 locked-rule checks across 20 distinct candidate/quarter/cost combinations. Repeated checks are not new strategies or independent experiments and are excluded from candidate counts.
