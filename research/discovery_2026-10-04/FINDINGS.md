# Funding-audited findings

**0 of 22 locked strategy families meet the final-test screen with observed funding rates.** Public funding coverage: 14 markets. The assumptions-based search and its90-minute session remain recorded in BASE_FINDINGS.md.

Rates use actual published settlement timestamps and signed rates. Payment notional uses quantity times the nearest preceding candle close, rather than an unavailable historical mark-price snapshot. Possible funding debits in uncertain exit candles are charged; ambiguous credits are excluded. Exchange quantity specifications are current, not historically reconstructed.

|Rank|Strategy|Entry/confirm/direction min|Trades|Net USD|Net %|PF|Drawdown|Win %|Double-cost net USD|Gas-stress net USD|Qualifies|
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
|1|rsi2_trend|120/240/480|279|-12.09|-4.84%|0.870|8.44%|48.4%|-28.38|-230.37|NO|
|2|trendline_break|120/240/480|345|-21.03|-8.41%|0.864|12.35%|42.3%|-34.43|-230.03|NO|
|3|efficiency_momentum|60/120/240|336|-5.22|-2.09%|0.976|13.93%|34.2%|-25.64|-230.20|NO|
|4|engulfing_pullback|120/240/480|347|-20.89|-8.36%|0.886|13.66%|39.8%|-36.30|-231.02|NO|
|5|volatility_drift|60/120/240|289|-24.16|-9.66%|0.814|15.21%|41.2%|-44.14|-230.52|NO|
|6|relative_strength|120/240/480|324|-24.19|-9.68%|0.774|11.77%|46.9%|-38.63|-221.05|NO|
|7|exhaustion_reversal|30/60/120|403|-35.77|-14.31%|0.764|17.54%|43.9%|-64.97|-230.85|NO|
|8|compression_breakout|60/120/240|293|-17.76|-7.10%|0.893|15.45%|38.6%|-39.89|-230.21|NO|
|9|anchored_vwap|30/60/120|321|-32.98|-13.19%|0.853|23.66%|23.4%|-50.35|-230.68|NO|
|10|three_bar_reversal|120/240/480|472|-31.15|-12.46%|0.740|17.93%|39.4%|-49.45|-230.58|NO|
|11|inside_bar|60/120/240|318|-48.40|-19.36%|0.694|26.50%|39.6%|-65.52|-231.09|NO|
|12|btc_lead_lag|120/240/480|404|-50.54|-20.22%|0.628|25.32%|38.6%|-71.72|-230.09|NO|
|13|mtf_pullback|30/60/120|426|-48.77|-19.51%|0.815|23.69%|34.0%|-73.56|-231.21|NO|
|14|obv_divergence|60/120/240|287|-33.49|-13.40%|0.809|19.31%|26.8%|-53.81|-231.90|NO|
|15|session_breakout|120/240/480|314|-17.13|-6.85%|0.808|11.35%|40.1%|-30.38|-223.53|NO|

Ranking prioritises qualification, validation/final positivity, doubled trading-cost survival, block-bootstrap lower bound, cross-market breadth, worst historical PF, drawdown, count and net profit. Primary parameters were frozen from validation only, prioritising qualification and sufficient trade count before validation score. Below250 validation trades, count precedes score. PRIMARY_FROZEN.json records that policy and excludes final-result access. No final-period optimisation is performed. A loss-free tiny sample has no estimable PF; internal finite caps are not reported as a statistical estimate.

Entry eligibility uses the latest [dated CoinMarketCap weekly snapshot](https://coinmarketcap.com/historical/) only after an assumed2-day publication lag, and expires it after10days. A coin must have ranked in the top100 then. Relative-strength ranks exclude ineligible observed coins. This removes future weekly membership from entry eligibility, but the14-market data basket is still a currently selected subset; it is not a survivorship-free whole-market study. The selection search used the wider fixed basket; the locked primary audit adds this predeclared historical eligibility restriction.

## 1. rsi2_trend — d9dde30bdf17

Aligned higher direction; RSI2 below setting / above100-setting; close on trend side of selected slow EMA.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 2.75. Reward/risk: 3.25. Holding limit: 24h. Direction: short. Risk per trade: 0.50%. Entry EMA settings: slowEMA=55 bars. Family-specific settings: rsi=15. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 2. trendline_break — e4722ca6e57f

Close crosses projected line from last two confirmed descending highs/ascending lows; line age at most60 bars; volume ratio above1; no opposite higher alignment.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 2.0. Holding limit: 48h. Direction: both. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 3. efficiency_momentum — 4c53096d7a80

Aligned higher direction; 20-bar efficiency exceeds setting; close breaks prior10-bar high/low; volume ratio above1.

Entry/confirmation/direction: 60/120/240min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 72h. Direction: both. Risk per trade: 0.50%. Family-specific settings: efficiency=0.25. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 4. engulfing_pullback — 73f4f0b0d427

Bullish/bearish body engulfing at selected fast EMA, higher direction aligned, RSI14 below65 for long / above35 for short.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 2.25. Reward/risk: 2.25. Holding limit: 48h. Direction: both. Risk per trade: 0.50%. Entry EMA settings: fastEMA=21 bars. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 5. volatility_drift — fa44fb4f35ba

Aligned higher direction and fast/slow EMAs; realised volatility below0.8 times prior median; six-bar return turns positive/negative.

Entry/confirmation/direction: 60/120/240min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 24h. Direction: both. Risk per trade: 0.50%. Entry EMA settings: fastEMA=13 bars, slowEMA=55 bars. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 6. relative_strength — 2979ae55e29d

Higher direction aligned; selected fast EMA recross; own24-bar return rank above rank setting / below 1-rank across simultaneous eligible markets.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 24h. Direction: both. Risk per trade: 0.50%. Entry EMA settings: fastEMA=21 bars. Family-specific settings: rank=0.7. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 7. exhaustion_reversal — e7a088726b86

RSI14 below35/above65, rejection wick above50%, volume ratio above1.6 and higher ADX below25.

Entry/confirmation/direction: 30/60/120min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 12h. Direction: short. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 8. compression_breakout — 6ea5aed472f6

Prior 24-bar realised volatility below prior 100-bar median times compression setting; aligned higher direction; close breaks prior 20-bar high/low; volume above multiplier of prior 30-bar mean.

Entry/confirmation/direction: 60/120/240min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 2.0. Holding limit: 48h. Direction: both. Risk per trade: 0.50%. Family-specific settings: compression=0.85, volume=1.0. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 9. anchored_vwap — 7bb0bf4ef016

Cross VWAP anchored at most recently confirmed seven-bar pivot, with higher direction aligned; volume ratio above 0.8. Pivot is confirmed three bars late.

Entry/confirmation/direction: 30/60/120min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 120h. Direction: long. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 10. three_bar_reversal — 47d9ee71dc35

Two-bars-ago candle opposes entry direction, previous body below30% of range, current close breaks two-bars-ago high/low and aligns higher direction.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 12h. Direction: both. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 11. inside_bar — c0a2e19e6889

Previous candle is inside its predecessor; current close breaks previous high/low, body exceeds50% of range and higher direction aligns.

Entry/confirmation/direction: 60/120/240min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 2.75. Reward/risk: 3.25. Holding limit: 24h. Direction: short. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 12. btc_lead_lag — eaa663b83e4c

BTC six-bar return exceeds movement setting; asset move less than half BTC move in that direction; own higher trend and current candle align.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 1.75. Reward/risk: 1.75. Holding limit: 12h. Direction: both. Risk per trade: 0.50%. Family-specific settings: btc_move=0.007. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 13. mtf_pullback — a5ad909a3b06

Higher trend EMA21/55 and confirmation close/EMA21 aligned; regime ADX above setting; candle crosses selected fast EMA with directional close; RSI14 42–68 long / 32–58 short.

Entry/confirmation/direction: 30/60/120min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 1.75. Holding limit: 120h. Direction: short. Risk per trade: 0.50%. Entry EMA settings: fastEMA=34 bars. Family-specific settings: adx=15. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 14. obv_divergence — b522140c6c4d

New prior10-bar price low/high with positive/negative normalised10-bar OBV change above0.15 magnitude, directional candle, no opposite higher alignment.

Entry/confirmation/direction: 60/120/240min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 1.75. Reward/risk: 3.5. Holding limit: 72h. Direction: both. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## 15. session_breakout — b9ec22441786

Aligned higher direction; UTC candle start hour07–16 inclusive; close breaks prior20-bar high/low; volume ratio above1.5.

Entry/confirmation/direction: 120/240/480min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: 3.0. Reward/risk: 3.5. Holding limit: 12h. Direction: both. Risk per trade: 0.50%. Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.

## Repeated patterns, predictors and order-book findings

Detailed pattern and prediction findings: CANDLE_AND_PREDICTION_FINDINGS.md. Real depth observations: ORDERBOOK_FINDINGS.md and the live orderbook_heatmap.html. Adjacent timeframes: TIMEFRAME_FINDINGS.md. Research sources and critiques: RESEARCH_CRITIQUE.md and RESEARCH_UPDATES.md. Source hashes, dataset dates, elapsed time and variant count: reproduction_manifest.json. Candidate-run versus distinct-settings counts: TRIAL_COUNTS.md. Reproduction of these audited figures uses reproduce_lab.py ID --phase test --historical-funding. Audited trade/equity ledgers are funding_trades_ID.json / funding_equity_ID.json.

CEX fees/slippage assumptions, fully collateralised sizing, stops, gas stress, bias disclosures and complete base settings are in BASE_FINDINGS.md. Gas stress doubles trading costs and adds$1 per round trip; it does not reconstruct DEX pool fees, routes, MEV or execution. Earlier local research used parts of the2026 history, so this is a final period excluded from parameter selection in this run, not a globally unseen historical sample. A fresh forward paper review remains necessary. A passed screen is not evidence of guaranteed accuracy or future profits. Strategies failing any requirement remain research candidates. Bots remain stopped.