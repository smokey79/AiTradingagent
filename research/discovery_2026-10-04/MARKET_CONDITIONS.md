# Market-condition diagnostics

Entry ADX14 below20 is labelled weak trend,20–25 transitional, and25 or above stronger trend. These are descriptive labels, not definitive market states. Identical frozen rules are used throughout; no final-period tuning or automatic switching follows from these results.

|Strategy|Entry regime|Trades|Net USD|PF|
|---|---|---:|---:|---:|
|rsi2_trend|weak trend|104|-10.35|0.7389545728302748|
|rsi2_trend|transitional|53|3.84|1.2564058196251036|
|rsi2_trend|stronger trend|122|-5.58|0.8545512349918045|
|trendline_break|weak trend|120|-4.46|0.9169271565335028|
|trendline_break|transitional|58|5.44|1.2301702123085638|
|trendline_break|stronger trend|167|-22.01|0.7144482819073199|
|efficiency_momentum|weak trend|138|-12.22|0.8623534342664583|
|efficiency_momentum|transitional|49|1.53|1.0583255512783365|
|efficiency_momentum|stronger trend|149|5.48|1.053983929719809|
|engulfing_pullback|weak trend|124|-11.28|0.8373715614826199|
|engulfing_pullback|transitional|59|15.30|1.6051154999291217|
|engulfing_pullback|stronger trend|164|-24.91|0.721105293764411|
|volatility_drift|weak trend|102|-5.17|0.8927870231394022|
|volatility_drift|transitional|47|-7.32|0.5954577916553876|
|volatility_drift|stronger trend|140|-11.67|0.8173339353107307|
|relative_strength|weak trend|92|-6.62|0.7971871842820628|
|relative_strength|transitional|58|0.65|1.0405097829242593|
|relative_strength|stronger trend|174|-18.22|0.6881925643832629|
|exhaustion_reversal|weak trend|257|-21.66|0.7829098829447034|
|exhaustion_reversal|transitional|146|-14.11|0.7275904482937433|
|exhaustion_reversal|stronger trend|0|0.00|not estimable|
|compression_breakout|weak trend|133|4.29|1.0611740695133618|
|compression_breakout|transitional|50|-10.15|0.6558985946507477|
|compression_breakout|stronger trend|110|-11.89|0.821960204749755|
|anchored_vwap|weak trend|115|-2.88|0.9620074811141027|
|anchored_vwap|transitional|75|-28.66|0.4995421868903824|
|anchored_vwap|stronger trend|131|-1.44|0.9841073602252103|
|three_bar_reversal|weak trend|150|-18.38|0.5943221687421286|
|three_bar_reversal|transitional|92|10.64|1.6165857859562927|
|three_bar_reversal|stronger trend|230|-23.42|0.5903443415327171|
|inside_bar|weak trend|131|-14.86|0.766364586873781|
|inside_bar|transitional|60|-21.62|0.3776206963022241|
|inside_bar|stronger trend|127|-11.92|0.8007029009765728|
|btc_lead_lag|weak trend|118|-24.90|0.4536763701048319|
|btc_lead_lag|transitional|59|-6.53|0.7128054278629489|
|btc_lead_lag|stronger trend|227|-19.10|0.7172457489186964|
|mtf_pullback|weak trend|106|-25.76|0.6405630937866201|
|mtf_pullback|transitional|108|-12.40|0.8107361081685462|
|mtf_pullback|stronger trend|212|-10.62|0.916045867945908|
|obv_divergence|weak trend|100|1.86|1.0334923383480792|
|obv_divergence|transitional|59|-6.81|0.8163666951566931|
|obv_divergence|stronger trend|128|-28.54|0.6540218532102552|
|session_breakout|weak trend|107|-4.52|0.8337369543064191|
|session_breakout|transitional|66|-4.47|0.7502242994912357|
|session_breakout|stronger trend|141|-8.14|0.8150570214762912|

Subgroups can be small and different families can trade the same events. This breakdown does not qualify a subgroup independently. The disabled strategy_switch_policy.json requires a fresh paper review and sustained deterioration before changing a live strategy. Portfolio results, capacity, historical funding and market-cap eligibility remain in FINDINGS.md.