# Crypto strategy discovery — 4 October 2026

Actual timed run: **90.00 minutes**. 18,755 parameter trials across 20 main families, plus failure-directed refinements. Trading bots stayed stopped.

**0 of 22 distinct research families qualify on the final test.** Fifteen ranked candidates are provided below; failed candidates are labelled, never promoted as profitable strategies.

Markets: BTC, ETH, SOL, AVAX, ARB, CRO, LTC, TRX, ZEC, SUI, ICP, AAVE, ATOM, POL USDT perpetuals selected from the current top100 with available history. This is a14-market screen, not all100.

Training: Jan2024–Jun2025. Validation: Jul2025–Jan2026. Reserved final test: Feb2026–latest common complete data on4Oct2026. POL begins later. Current market-cap selection and instrument filters introduce survivorship/historical-specification limits.

Qualification: positive net profit, at least250 completed portfolio trades, dollar and notional-return PF>1.12, maximum drawdown≤20%. These screening rules do not establish future profitability.

|Rank|Strategy|Entry / confirm / direction|Trades|Net USD / %|PF|Max DD|Win %|Double-cost net USD|Pass|
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
|1|btc_lead_lag|120/240/480 min|161|12.93 / 5.17%|1.123|10.86%|38.5%|1.66|NO|
|2|volume_climax|120/240/480 min|23|4.12 / 1.65%|1.386|1.95%|47.8%|2.66|NO|
|3|range_zscore|60/120/240 min|10|7.37 / 2.95%|2.450|1.92%|50.0%|5.83|NO|
|4|efficiency_momentum|60/120/240 min|337|-0.95 / -0.38%|0.996|14.09%|35.0%|-28.49|NO|
|5|rsi2_trend|120/240/480 min|279|-12.95 / -5.18%|0.861|8.40%|48.0%|-29.41|NO|
|6|trendline_break|120/240/480 min|345|-23.46 / -9.38%|0.849|13.08%|41.4%|-37.51|NO|
|7|engulfing_pullback|120/240/480 min|347|-24.30 / -9.72%|0.868|14.60%|39.5%|-40.11|NO|
|8|relative_strength|120/240/480 min|324|-25.74 / -10.30%|0.761|12.10%|46.6%|-40.06|NO|
|9|volatility_drift|120/240/480 min|229|-24.31 / -9.72%|0.736|10.83%|41.5%|-36.55|NO|
|10|compression_breakout|60/120/240 min|293|-19.58 / -7.83%|0.882|16.15%|38.6%|-41.64|NO|
|11|anchored_vwap|30/60/120 min|320|-32.38 / -12.95%|0.856|23.08%|23.8%|-52.88|NO|
|12|inside_bar|60/120/240 min|318|-48.97 / -19.59%|0.691|26.50%|39.6%|-66.07|NO|
|13|exhaustion_reversal|60/120/240 min|142|-10.31 / -4.13%|0.812|7.60%|40.8%|-20.15|NO|
|14|channel_retest|60/120/240 min|315|-16.55 / -6.62%|0.871|12.46%|42.2%|-36.47|NO|
|15|range_reclaim|60/120/240 min|344|-38.29 / -15.32%|0.826|21.94%|32.6%|-58.18|NO|

Rank prioritises qualification, positive validation/test, doubled-cost survival, block-bootstrap lower bound, profitable market breadth, worst train/validation/test PF, drawdown, trade count and net profit. The per-family representative was chosen using validation score only. The rank itself describes final-test results and must not be used to retune that period.

## Reproducible rules and settings

Every family uses only completed candles, next-open entry, ATR14, fixed ATR stop, fixed reward/risk target, opposite-signal next-open exit and holding limit. Higher direction uses4× entry timeframe EMA21/55; confirmation uses2× entry close relative toEMA21. Stop fills take adverse gaps; ambiguous stop/target bars stop first. EMA uses pandas recursive exponential weighting, not Pine SMA-seeded EMA. ATR/RSI/ADX use recursive Wilder smoothing. Default account$250, risk0.5%, max3 positions, per-market25%, total60%, no leverage. Current exchange quantity increments and minimums apply. Fees0.06% per side; spread/slippage2bps BTC/ETH or4bps others plus participation impact; funding1bp per8h debit; gas0 for CEX. Stress doubles trading fees/slippage; separate gas stress adds$1 per round trip. These are cost assumptions, not an account-specific fee quotation.

### 1. btc_lead_lag — a6db5ba937e0

BTC six-bar return exceeds movement setting; asset move less than half BTC move in that direction; own higher trend and current candle align.

Settings: entry120min; EMA13/89 (26.0/178.0 hours); ATR stop3.0; reward/risk3.5; ADX20; max hold120h; directionboth; risk0.50%. Other settings: compression0.7, volume1, rank0.6, efficiency0.25, RSI2 threshold10, z-score1.5, BTC movement0.005. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: fewer than250 trades. Seven-day block-bootstrap95% net interval: $-38.30 to$69.47. This interval is not adjusted for variant selection.

### 2. volume_climax — 49f6055d4c7a

Volume ratio above2.5, rejection wick above45%, new prior10-bar extreme, directional close; disallow opposite higher alignment.

Settings: entry120min; EMA13/100 (26.0/200.0 hours); ATR stop3.0; reward/risk1.75; ADX20; max hold72h; directionlong; risk0.50%. Other settings: compression0.7, volume1, rank0.6, efficiency0.25, RSI2 threshold10, z-score1.5, BTC movement0.005. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: fewer than250 trades. Seven-day block-bootstrap95% net interval: $-10.60 to$17.39. This interval is not adjusted for variant selection.

### 3. range_zscore — ef213866f6a2

Higher ADX below setting and20-bar efficiency below0.3; 30-bar close z-score outside setting; candle closes toward mean.

Settings: entry60min; EMA34/89 (34.0/89.0 hours); ATR stop2.25; reward/risk3.5; ADX20; max hold120h; directionshort; risk0.50%. Other settings: compression1.0, volume1.5, rank0.8, efficiency0.45, RSI2 threshold20, z-score2.5, BTC movement0.01. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: fewer than250 trades. Seven-day block-bootstrap95% net interval: $-3.84 to$19.41. This interval is not adjusted for variant selection.

### 4. efficiency_momentum — 4c53096d7a80

Aligned higher direction; 20-bar efficiency exceeds setting; close breaks prior10-bar high/low; volume ratio above1.

Settings: entry60min; EMA13/55 (13.0/55.0 hours); ATR stop3.0; reward/risk3.5; ADX25; max hold72h; directionboth; risk0.50%. Other settings: compression0.7, volume1, rank0.6, efficiency0.25, RSI2 threshold10, z-score1.5, BTC movement0.005. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-67.24 to$75.90. This interval is not adjusted for variant selection.

### 5. rsi2_trend — d9dde30bdf17

Aligned higher direction; RSI2 below setting / above100-setting; close on trend side of selected slow EMA.

Settings: entry120min; EMA34/55 (68.0/110.0 hours); ATR stop2.75; reward/risk3.25; ADX15; max hold24h; directionshort; risk0.50%. Other settings: compression0.85, volume1.0, rank0.7, efficiency0.2, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-48.68 to$24.58. This interval is not adjusted for variant selection.

### 6. trendline_break — e4722ca6e57f

Close crosses projected line from last two confirmed descending highs/ascending lows; line age at most60 bars; volume ratio above1; no opposite higher alignment.

Settings: entry120min; EMA21/100 (42.0/200.0 hours); ATR stop3.0; reward/risk2.0; ADX15; max hold48h; directionboth; risk0.50%. Other settings: compression0.85, volume1.5, rank0.8, efficiency0.2, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-66.38 to$15.28. This interval is not adjusted for variant selection.

### 7. engulfing_pullback — 73f4f0b0d427

Bullish/bearish body engulfing at selected fast EMA, higher direction aligned, RSI14 below65 for long / above35 for short.

Settings: entry120min; EMA21/89 (42.0/178.0 hours); ATR stop2.25; reward/risk2.25; ADX15; max hold48h; directionboth; risk0.50%. Other settings: compression0.85, volume1.0, rank0.6, efficiency0.4, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-75.70 to$28.91. This interval is not adjusted for variant selection.

### 8. relative_strength — 2979ae55e29d

Higher direction aligned; selected fast EMA recross; own24-bar return rank above rank setting / below 1-rank across simultaneous eligible markets.

Settings: entry120min; EMA21/100 (42.0/200.0 hours); ATR stop3.0; reward/risk3.5; ADX20; max hold24h; directionboth; risk0.50%. Other settings: compression0.85, volume1.2, rank0.7, efficiency0.35, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-53.13 to$2.24. This interval is not adjusted for variant selection.

### 9. volatility_drift — 7081911575c5

Aligned higher direction and fast/slow EMAs; realised volatility below0.8 times prior median; six-bar return turns positive/negative.

Settings: entry120min; EMA21/55 (42.0/110.0 hours); ATR stop2.75; reward/risk3.0; ADX15; max hold24h; directionboth; risk0.50%. Other settings: compression0.85, volume1.0, rank0.6, efficiency0.3, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; fewer than250 trades; profit factor threshold. Seven-day block-bootstrap95% net interval: $-55.60 to$4.25. This interval is not adjusted for variant selection.

### 10. compression_breakout — 6ea5aed472f6

Prior 24-bar realised volatility below prior 100-bar median times compression setting; aligned higher direction; close breaks prior 20-bar high/low; volume above multiplier of prior 30-bar mean.

Settings: entry60min; EMA13/89 (13.0/89.0 hours); ATR stop3.0; reward/risk2.0; ADX12; max hold48h; directionboth; risk0.50%. Other settings: compression0.85, volume1.0, rank0.7, efficiency0.2, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-74.85 to$32.29. This interval is not adjusted for variant selection.

### 11. anchored_vwap — 7bb0bf4ef016

Cross VWAP anchored at most recently confirmed seven-bar pivot, with higher direction aligned; volume ratio above 0.8. Pivot is confirmed three bars late.

Settings: entry30min; EMA34/55 (17.0/27.5 hours); ATR stop3.0; reward/risk3.5; ADX15; max hold120h; directionlong; risk0.50%. Other settings: compression1.0, volume1.5, rank0.8, efficiency0.45, RSI2 threshold20, z-score2.5, BTC movement0.01. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold; drawdown threshold. Seven-day block-bootstrap95% net interval: $-103.72 to$43.44. This interval is not adjusted for variant selection.

### 12. inside_bar — c0a2e19e6889

Previous candle is inside its predecessor; current close breaks previous high/low, body exceeds50% of range and higher direction aligns.

Settings: entry60min; EMA34/89 (34.0/89.0 hours); ATR stop2.75; reward/risk3.25; ADX15; max hold24h; directionshort; risk0.50%. Other settings: compression1.0, volume1.25, rank0.7, efficiency0.2, RSI2 threshold20, z-score2.5, BTC movement0.01. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold; drawdown threshold. Seven-day block-bootstrap95% net interval: $-94.55 to$1.50. This interval is not adjusted for variant selection.

### 13. exhaustion_reversal — e2418dee37a8

RSI14 below35/above65, rejection wick above50%, volume ratio above1.6 and higher ADX below25.

Settings: entry60min; EMA21/89 (21.0/89.0 hours); ATR stop3.0; reward/risk1.25; ADX20; max hold24h; directionlong; risk0.50%. Other settings: compression0.85, volume1.2, rank0.7, efficiency0.35, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; fewer than250 trades; profit factor threshold. Seven-day block-bootstrap95% net interval: $-37.30 to$14.88. This interval is not adjusted for variant selection.

### 14. channel_retest — 39cfeb70c6de

Previous close breaks its prior20-bar channel; current candle retests that frozen breakout boundary and closes on breakout side, with higher direction aligned.

Settings: entry60min; EMA13/89 (13.0/89.0 hours); ATR stop2.25; reward/risk3.25; ADX20; max hold12h; directionlong; risk0.50%. Other settings: compression0.7, volume1.5, rank0.6, efficiency0.2, RSI2 threshold10, z-score1.5, BTC movement0.005. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold. Seven-day block-bootstrap95% net interval: $-55.35 to$28.01. This interval is not adjusted for variant selection.

### 15. range_reclaim — f9d3a70a9cf3

Sweep prior 20-bar low/high then close back within range; rejection wick exceeds 40% of candle range; disallow opposite aligned higher direction.

Settings: entry60min; EMA21/89 (21.0/89.0 hours); ATR stop2.75; reward/risk3.5; ADX25; max hold120h; directionboth; risk0.50%. Other settings: compression0.85, volume1.5, rank0.8, efficiency0.2, RSI2 threshold15, z-score2.0, BTC movement0.007. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.

Status: net loss; profit factor threshold; drawdown threshold. Seven-day block-bootstrap95% net interval: $-88.00 to$14.86. This interval is not adjusted for variant selection.

## Prediction, patterns and live depth

prediction_results.json reports next1/2/3-candle diagnostics from training-only ridge models, thresholds selected on validation and then frozen. Overlapping prediction observations are not completed portfolio trades. candle_pattern_occurrences.csv records repeated engulfing, inside-bar, wick, doji and three-bar patterns by market, regime and horizon. Final-period pattern findings are exploratory and never retune frozen strategy rules. Intervals assuming independence are explicitly labelled; overlapping candles reduce effective sample size.

orderbook_heatmap.html connects directly to the public feed when opened in a browser. orderbook_samples.jsonl contains actual recorded50-level depth and executed trade quantities. orderbook_pilot_results.json assesses a short observational5-second predictor; it cannot qualify a deployable strategy. Candle volume is never represented as historical order-book depth.

## Reproduce

Use the saved datasets and instrument_filters.json; do not refresh them before reproducing. From this directory run the existing research Python environment with reproduce_lab.py CANDIDATE_ID --phase test. Add --cost2 for doubled fees/slippage, or --cost2 --gas1 for the gas scenario. Package versions and hashes are recorded in reproduction_manifest.json. See RESEARCH_CRITIQUE.md for linked academic papers, the legal free forecasting textbook, credentialed practitioner interviews and transferability critiques.

## Strategy switching

A single losing trade is not a switching trigger. Keep a precommitted regime map, reserve a new forward paper-trading sample, and monitor rolling cost-adjusted expectancy, spread/liquidity and drawdown. Suspend entries on invalid/stale data or breached risk limits. Change to another qualified strategy only after that strategy passes a separate regime-specific forward review; never choose hindsight winners from the same losing window. No live bot or wallet transfer was started.