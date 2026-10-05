# Timeframe stability audit

The fifteen final-ranked families were run at half and double their entry interval, with the same settings measured in bars and unchanged risk/reward. Confirmation/direction remain2×/4× entry. These are locked-rule robustness diagnostics, not newly selected winners. Changing timeframe also changes the elapsed EMA/channel horizon; the table makes that dependency visible.

|Family|Original entry min|Audit entry min|Trades|Net USD|PF|Drawdown|Screen pass|
|---|---:|---:|---:|---:|---:|---:|---|
|rsi2_trend|120|60|386|-46.22|0.729|21.30%|NO|
|rsi2_trend|120|240|208|-16.67|0.665|7.67%|NO|
|trendline_break|120|60|492|-0.08|1.000|11.72%|NO|
|trendline_break|120|240|230|-12.04|0.855|12.20%|NO|
|efficiency_momentum|60|30|524|-17.81|0.948|21.34%|NO|
|efficiency_momentum|60|120|220|8.61|1.075|11.53%|NO|
|engulfing_pullback|120|60|523|-58.76|0.793|30.63%|NO|
|engulfing_pullback|120|240|257|-15.22|0.857|14.01%|NO|
|volatility_drift|60|30|491|-50.87|0.810|29.29%|NO|
|volatility_drift|60|120|226|-17.52|0.786|9.33%|NO|
|relative_strength|120|60|487|-49.13|0.769|25.35%|NO|
|relative_strength|120|240|195|-4.67|0.901|5.34%|NO|
|exhaustion_reversal|30|15|674|-42.02|0.843|19.40%|NO|
|exhaustion_reversal|30|60|202|-10.31|0.865|11.46%|NO|
|compression_breakout|60|30|570|-46.75|0.849|26.20%|NO|
|compression_breakout|60|120|189|-25.44|0.749|15.28%|NO|
|anchored_vwap|30|15|526|-30.47|0.897|24.40%|NO|
|anchored_vwap|30|60|182|4.14|1.033|15.74%|NO|
|three_bar_reversal|120|60|709|-28.61|0.866|23.07%|NO|
|three_bar_reversal|120|240|258|13.95|1.309|2.55%|YES|
|inside_bar|60|30|456|-42.01|0.824|27.93%|NO|
|inside_bar|60|120|213|-29.57|0.628|16.63%|NO|
|btc_lead_lag|120|60|508|-50.83|0.750|24.51%|NO|
|btc_lead_lag|120|240|317|-25.93|0.720|12.50%|NO|
|mtf_pullback|30|15|775|-57.49|0.851|30.01%|NO|
|mtf_pullback|30|60|242|-43.26|0.742|21.63%|NO|
|obv_divergence|60|30|559|-53.96|0.807|33.61%|NO|
|obv_divergence|60|120|148|-4.11|0.960|9.47%|NO|
|session_breakout|120|60|493|-40.16|0.761|21.22%|NO|
|session_breakout|120|240|188|-3.33|0.915|7.91%|NO|

A family profitable only at one precise interval is less convincing than one surviving adjacent intervals. These audits use the already reported final period; future model selection needs a fresh forward sample. Very short intervals incur more cost relative to candle movement. A five-minute historical study would require a separate five-minute dataset; it was not reconstructed from15-minute bars.