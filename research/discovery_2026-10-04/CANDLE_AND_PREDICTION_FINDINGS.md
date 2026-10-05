# Candle patterns and next-candle predictions

The models use completed hourly candles. They predict next-open to future-close changes. Mean/scale and ridge coefficients use only the training period; thresholds were selected on validation and frozen before the final period. Forecast events overlap and do not constitute portfolio trades.

|Horizon|All final observations|Direction accuracy|Always-up baseline|Filtered events|Filtered accuracy|Mean net bps, overlapping events|
|---:|---:|---:|---:|---:|---:|---:|
|1 candles|82488|49.17%|49.27%|62|53.2258064516129|24.125920692661413|
|2 candles|82474|49.57%|49.49%|52|59.61538461538461|-9.140496728405292|
|3 candles|82460|49.23%|49.31%|54|48.148148148148145|-46.70246955607382|

Filtering can improve a selected sample while reducing opportunities. These are descriptive final diagnostics, not validated portfolio PF/drawdown. Costs in this diagnostic are fixed16bps BTC/ETH and20bps other markets; funding, position overlap and stops are handled in the separate strategy simulator.

## Repeating candle forms

Counts below aggregate the final exploratory period across tested coins, all regimes and one-candle horizon. The same forms recur often; a high count does not establish predictive power. Conditional results by market, aligned trend/range and1/2/3-candle horizon are in candle_pattern_occurrences.csv. These exploratory readings never change frozen strategy rules.

|Pattern|Occurrences|Weighted direction hit rate|Mean signed gross bps|Mean after cost bps|
|---|---:|---:|---:|---:|
|bearish_engulfing|10350|48.81%|0.913|-18.513|
|bullish_engulfing|10389|46.64%|-1.125|-20.524|
|doji_follow_previous_direction|10916|44.57%|-1.781|-21.181|
|inside_bar_down_break|3529|45.31%|-2.032|-21.369|
|inside_bar_up_break|3490|47.68%|1.192|-18.139|
|lower_wick_rejection|6147|49.00%|-0.343|-19.735|
|three_bar_down_reversal|1935|48.58%|2.064|-17.359|
|three_bar_up_reversal|1971|46.42%|1.939|-17.408|
|upper_wick_rejection|5995|47.41%|-2.094|-21.465|

## Patterns within selected strategy trades

This compares overlapping attributes of final-test trades from the primary audit, including historical funding and known weekly market-cap eligibility. It describes association within selected rules; it is not a newly qualified strategy or an independent causal effect.

|Attribute|Trade observations|Win rate|Net USD|
|---|---:|---:|---:|
|engulfing|1665|36.76%|-178.34|
|inside|299|41.47%|-16.04|
|rejection_wick_above_50pct|824|40.66%|-50.86|
|volume_above_1.5x|2303|38.30%|-161.44|

Different strategies can trade the same event, so pooled observations are correlated and duplicated across families. Cell-level Wilson intervals assume independence and are optimistic. Robust candidate uncertainty is estimated separately by seven-day blocks of exit-day PnL. None of these pattern findings justifies closing and reopening a live trade on its own.