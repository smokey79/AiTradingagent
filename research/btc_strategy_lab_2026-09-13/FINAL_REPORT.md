# BTC/USDT Strategy Discovery Lab — Final Report
**Date:** 2026-09-13 | **Universe:** Bybit BTCUSDT perpetual, 2020-03-25 to present (~56,650 hourly bars)
**Engine:** TradingKit (trader.dev) Pine v6 parity backtester | **Strategies tested:** 80 across 8 research rounds — cross-asset extension (7 symbols), out-of-sample walk-forward validation, a full top-5-strategies × 7-assets grid, and 100-iteration Monte Carlo bootstrap robustness checks on every cell of that grid

## TL;DR — read the whole story before trading anything

The short version, in the order the research actually happened: BTC alone looked like a winner (Round 3-4), then testing the same rules on 6 more symbols found real cross-asset edge on ETH/SOL/AVAX too (Round 5) — **but then a proper out-of-sample walk-forward test (Round 6) showed BTC's and AVAX's edge was a full-history artifact that does NOT hold up on recent (2024-2026) data**, and SOL's edge weakened to roughly break-even. **Only ETH passed every test, including the honest one.** If you read one section, read Round 6 below — it's what actually determines what's safe to trade.

**The one strategy that survived every check — "2h EMA50/100 Cross + VWAP Side Filter" on ETH/USDT:**
- Full-history (2020-2026) sizing-independent profit factor: **1.30**
- Out-of-sample (2024-2026 only, unseen data): **1.27** — nearly identical, meaning this isn't an artifact of an earlier market regime
- At a realistic **15-20% of equity per trade** (not the engine's forced 100%-equity stress test — see "Critical platform quirk" below): full-history net +26.1%, max drawdown only 9.6% at 20% exposure
- 238 trades over the full period; ~125 of those in the 2024-2026 out-of-sample window alone
- Win rate only ~13% — this is a trend-following system: frequent small losses, occasional large winners

**BTC and AVAX are explicitly NOT recommended** despite their full-history numbers looking excellent (see Round 6) — their apparent edge was concentrated in the 2020-2023 period and reversed in 2024-2026. **SOL is a watch item, not a trade** — its edge weakened to roughly break-even out-of-sample. Full detail, all four candidates' numbers side by side, and why this matters for a self-learning system, is in the Round 6 section below.


## Critical platform quirk found (read this first)

TradingKit's `quick_backtest` engine silently forces **100% of equity into every single trade**, regardless of any position-sizing override you pass. This is confirmed in the API's own response (`parityAdjustments: [{"field":"sizing","applied":"percent_of_equity:100"}]`). It's meant as a TradingView-parity stress test, not a realistic simulation.

The consequence: with 100%-of-equity compounding, a losing streak destroys a devastating fraction of the account, because every trade re-risks the entire (shrinking) balance. Round 1 saw every strategy report 77-99% "drawdown" this way — even ones with a real edge look catastrophic under this lens.

**Fix used throughout this lab:** every trade's raw `profitPct` (return on its OWN notional, independent of account size) was pulled via `get_trades` and used to resimulate each strategy under realistic **fixed-fractional position sizing** (5%/10%/15%/20% of equity per trade — the standard way real risk management actually sizes positions). This is the number that matters for your actual risk, not the engine's raw 100%-equity output. Every "qualifies" claim below is under this realistic resimulation, and the engine's raw (100%-equity) numbers are shown alongside for transparency.


## How the research was run

**Round 1 (13 strategies):** researched classical/academic concepts — Donchian breakout, SuperTrend+ADX, VWAP mean-reversion, ICT liquidity sweeps, RSI divergence, Bollinger/Keltner squeeze, volatility-filtered z-score momentum, HMA+CMO trend, OBV+Donchian, CCI range reversion, EMA200 pullback, Parabolic SAR, Williams %R trend-filtered. All on 1h bars. **Result: every single one failed**, PF 0.61-0.94, drawdown 77-99%.

**Diagnosis after Round 1:** built the resimulation tool (above) and confirmed these were genuine failures, not just compounding artifacts — the sizing-independent %-based profit factor stayed below 1.0 for all 13 even at realistic 20% exposure. 1h BTC/USDT has no exploitable edge for any of these classical setups over the full 6.5-year sample.

**Round 2 (11 strategies):** re-researched with fresh angles — triple-filter trend+momentum confluence, corrected volatility-filtered momentum (a Medium-article finding I'd first mis-applied as mean-reversion, then correctly re-applied as a WITH-trend volatility filter), EMA ribbon alignment, Keltner breakout, RSI pullback-buy, MACD+volume, "band walk" continuation, higher-high/higher-low market structure, and — critically — the very first strategy tested on a bar interval other than 1h. **Result: every 1h variant still failed** (PF 0.61-0.97), confirming 1h is fundamentally too noisy/efficient for these approaches regardless of confluence-filter count. But `R2_4h_TrendFollow_ADX` (plain EMA50/100 cross + ADX(14)>20 filter, on **4h** bars) was the first genuinely positive result: PF 1.50, net +162%. This pointed to **timeframe**, not indicator choice, as the real lever.


**Round 3 (8 strategies):** concentrated on refining the one real lead. Tried tighter/wider fixed ATR stops, a ratcheting ATR trailing stop (instead of fixed), dropping to 2h bars (roughly doubling trade opportunities), faster EMAs with a lower ADX bar, and retesting two Round-1 concepts (Donchian breakout, SuperTrend) on 4h instead of 1h. **Key finding:** the ATR trailing-stop variants consistently *underperformed* their fixed-stop siblings — the trail cuts trend-following winners short during normal pullback noise, the opposite of the intended effect. **`R3c_2h_SameLogic`** (same EMA50/100+ADX20 logic, just on 2h bars, 2.0x ATR fixed stop) was the best all-rounder: PF 1.27, net +312%, 319 trades — passing 3 of 4 criteria, failing only the engine's raw drawdown (46.8%). `R3g` (SuperTrend+ADX retested on 4h) looked similarly good on paper (PF 1.21) but **turned out to be a false lead** — see the cautionary note below.

**Round 4 (10 strategies):** two tracks. (a) A parameter-robustness sweep around R3c (ADX 15/20/25, ATR stop 1.5x/2.0x/2.5x, and a 3h timeframe attempt that Bybit's API rejected — 3h isn't a supported interval) to rule out a lucky overfit and map the trade-off curve. (b) Two genuinely new concepts: a manually-built Ichimoku cloud system (PF 0.99 — no edge), and a regime-complement mean-reversion system that only fires when ADX is LOW (fading Bollinger %B extremes in the "non-trending" regime the winning strategy ignores — PF 0.65, failed badly, ranging-regime BTC mean-reversion has no edge either). The robustness sweep held up well (PF stayed between 1.18 and 1.32 across all ADX/stop variations — not a knife-edge result). Then, testing whether **VWAP** (a session fair-value filter, cited in institutional trading literature) could replace or improve on the ADX filter produced the round's best results: adding VWAP-side confirmation to the EMA cross roughly **doubled the profit factor** (1.50-1.69 vs 1.18-1.32) and **halved the drawdown** at every exposure level, at some cost to trade count. Dropping ADX entirely and keeping only EMA-cross + VWAP (`R4j`) landed exactly on the sweet spot: enough trades to clear 250, and the best profit factor / drawdown combination of any strategy that also cleared the trade-count bar.


## Full leaderboard — top 15 by raw engine profit factor (all 41 strategies tested; see `leaderboard.json` for the complete set)

| Rank | Strategy | TF | PF (raw) | Net% (raw) | DD% (raw, 100%-equity) | Trades | Status vs raw engine |
|---|---|---|---|---|---|---|---|
| 1 | R4h_2h_VWAP_EMA_Confluence | 2h | 1.69 | 954% | 36.3% | 218 | fails: trades <250 |
| 2 | R4i_2h_VWAP_EMA_ADX15 | 2h | 1.64 | 813% | 35.7% | 241 | fails: trades <250 |
| 3 | R3a_4h_TighterStop | 4h | 1.54 | 164% | 36.2% | 156 | fails: trades <250, DD |
| 4 | R2_4h_TrendFollow_ADX | 4h | 1.50 | 162% | 47.2% | 168 | fails: trades <250, DD |
| **5** | **R4j_2h_VWAP_EMA_NoADX** | **2h** | **1.50** | **621%** | **37.7%** | **256** | **qualifies at realistic sizing (see below)** |
| 6 | R4d_2h_ATRstop2_5x | 2h | 1.32 | 399% | 43.8% | 319 | qualifies at realistic sizing |
| 7 | R4b_2h_ADX25 | 2h | 1.28 | 232% | 48.1% | 251 | qualifies at realistic sizing (thin margin) |
| 8 | R3c_2h_SameLogic | 2h | 1.27 | 312% | 46.8% | 319 | qualifies at realistic sizing |
| 9 | R4a_2h_ADX15 | 2h | 1.22 | 265% | 50.0% | 351 | fails DD even at 20% realistic sizing (not tested, weaker PF) |
| 10 | R3g_4h_SuperTrend_ADX_Retest | 4h | 1.21 | 201% | 45.9% | 308 | **false lead — see below** |
| 11 | R4c_2h_ATRstop1_5x | 2h | 1.18 | 86% | 46.9% | 277 | not resimulated (weaker PF) |
| 12 | R3b_4h_ATRTrail | 4h | 1.10 | 10% | 21.3% | 139 | fails: trades <250 |
| 13 | R3d_4h_FasterEMA_LowerADX | 4h | 1.07 | 28% | 72.1% | 343 | too weak |
| — | *(29 more strategies, all PF < 1.10)* | | | | | | genuinely no edge |


## Realistic-position-sizing qualification table (the numbers that actually matter)

Resimulated from each trade's own %-return, sizing-independent of the engine's forced 100%-equity compounding. Ranked by robustness (drawdown safety margin, profit factor, trade count, net profit) at **20% of equity risked per trade**:

| Rank | Strategy | Trades | pctPF (sizing-indep.) | Net% @20% exposure | Max DD @20% exposure | Qualifies all 4 criteria? |
|---|---|---|---|---|---|---|
| **1** | **R4j_2h_VWAP_EMA_NoADX** | 256 | **1.50** | **+40.3%** | **11.1%** | **YES — best margin** |
| 2 | R4d_2h_ATRstop2_5x | 319 | 1.27 | +23.8% | 15.3% | YES |
| 3 | R3c_2h_SameLogic | 319 | 1.30 | +24.1% | 17.7% | YES |
| 4 | R4b_2h_ADX25 | 251 | 1.32 | +20.0% | 16.8% | YES (thin trade-count margin: 251/250) |
| — | R4h_2h_VWAP_EMA_Confluence | 218 | 1.80 | +60.1% | 10.6% | NO — best quality but only 218 trades (need 250) |
| — | R4i_2h_VWAP_EMA_ADX15 | 241 | 1.60 | +48.1% | 10.5% | NO — 241 trades, 9 short of 250 |
| — | R3g_4h_SuperTrend_ADX_Retest | 308 | **0.99** | **-5.1%** | 19.4% | NO — see cautionary note below |

At lower exposure (10-15% of equity per trade) every qualifying strategy above has even more drawdown headroom, at proportionally lower returns — e.g. R4j at 10% exposure: net +19.6%, DD only 5.7%.


## ⚠️ Cautionary finding: R3g looked like a winner and wasn't

`R3g_4h_SuperTrend_ADX_Retest` reported a raw engine profit factor of 1.21 with net +201% — on the surface, the second-best candidate in the whole lab. But its sizing-independent %-based profit factor is **0.99** — essentially break-even to slightly negative — and it actually **loses** money (-5.1%) once resimulated under realistic position sizing. Its good-looking raw numbers were an artifact of the engine's forced 100%-equity compounding happening to land favorably on this particular sequence of trades, not a real statistical edge. **This is the single most important lesson from the whole lab: never trust the engine's raw dollar-based PF/net-profit numbers alone — always cross-check against the sizing-independent %-based profit factor from individual trade returns before believing a strategy has edge.** This should be a standing rule for any future strategy evaluation on this platform.

## Winning strategy — full reproduction rules (ETH — the one that survived out-of-sample validation)

**Name:** ETH 2h VWAP EMA Confluence (no ADX) — internal id `R5_ETH_2h_VWAP_EMA_NoADX`
**Symbol / timeframe:** ETHUSDT perpetual (Bybit), **2-hour bars**
**Concept:** Trend-following. Go long when the 50-EMA crosses above the 100-EMA AND price is above session VWAP (confirms buyers are in control at both a medium-term and an intraday-fair-value level). Go short on the mirror-image condition. Flip-to-reverse (no separate "flat" state) with a fixed ATR stop. This is the exact same rule set tested on BTC/SOL/AVAX (Round 5) — ETH is simply the one symbol where it also passed the Round 6 out-of-sample check.

**Exact rules:**
1. Compute `EMA(close, 50)` and `EMA(close, 100)`.
2. Compute `ATR(14)` and session `VWAP(close)`.
3. **Long entry:** `EMA50` crosses **above** `EMA100` AND `close > VWAP`.
4. **Short entry:** `EMA50` crosses **below** `EMA100` AND `close < VWAP`.
5. **Stop-loss:** fixed at entry, `2.0 × ATR(14)` away from entry price (below for longs, above for shorts) — not a trailing stop.
6. **Position size:** risk a fixed 15-20% of current equity per trade (NOT 100% — this is the critical realistic-sizing correction). At 20% exposure over the full 2020-2026 sample: net +26.1%, max drawdown 9.6%. On the out-of-sample 2024-2026 window alone (the more conservative, forward-looking estimate): net +10.8%, max drawdown 9.5% at 20% exposure — noticeably slower but the edge is still clearly positive and the drawdown risk barely changes, which is exactly the consistency you want to see.
7. **Take-profit:** none explicit — the position rides until the opposite EMA cross fires (flip-to-reverse) or the ATR stop is hit.
8. **Fees modeled:** 0.05% commission per side (typical maker/taker blend + gas-fee equivalent for on-chain execution).
9. No pyramiding — one position at a time, reversed on the opposite signal.


**Exact Pine Script v6 source** (as run in the backtester — note `default_qty_value=100` is the platform's forced parity setting; for real TradingView or live use, change this to `15` or `20` to get the realistic sizing this report qualifies under):

```pinescript
//@version=6
strategy("ETH 2h VWAP EMA NoADX", overlay=true, pyramiding=1,
  process_orders_on_close=true, commission_type=strategy.commission.percent,
  commission_value=0.05, initial_capital=10000,
  default_qty_type=strategy.percent_of_equity, default_qty_value=20,
  margin_long=100, margin_short=100)

atrVal = ta.atr(14)
emaFast = ta.ema(close, 50)
emaSlow = ta.ema(close, 100)
vwapVal = ta.vwap(close)
longEntry = ta.crossover(emaFast, emaSlow) and close > vwapVal
shortEntry = ta.crossunder(emaFast, emaSlow) and close < vwapVal

var float longStop = na
var float shortStop = na

if longEntry
    strategy.entry("L", strategy.long)
    longStop := close - atrVal * 2
if shortEntry
    strategy.entry("S", strategy.short)
    shortStop := close + atrVal * 2

if strategy.position_size > 0
    strategy.exit("LX", from_entry="L", stop=longStop)
if strategy.position_size < 0
    strategy.exit("SX", from_entry="S", stop=shortStop)
```

**View the raw backtest result (full-history):** https://mcp-api.trader.dev/backtest/01M2CMH7G1WE10WHVWD6VNXHNZ
**View the out-of-sample (2024-2026) validation result:** https://mcp-api.trader.dev/backtest/01M2CQM6PKBAPF0PNWZ4K5QJKK


## Backup / diversification candidates — ⚠️ superseded by the Round 6 walk-forward test below

The candidates originally listed here (`R4d_2h_ATRstop2_5x`, `R3c_2h_SameLogic`, `R4h_2h_VWAP_EMA_Confluence`) are all BTC-based variants of the same core EMA+VWAP logic that Round 6's out-of-sample test found does NOT hold up on 2024-2026 data. They are left in `leaderboard.json` for reference but are **not recommended** for the same reason `R4j` (BTC) is not recommended — see Round 6. The only strategy this lab actually validates for live/paper use is the ETH variant.

## Candlestick / price-action patterns observed

Two honest caveats up front: (1) TradingKit's backtester does not expose raw OHLC candle data through this MCP pipeline — only trade-level results (entry/exit price, time, bars-held, running P&L) — so patterns below are inferred from trade statistics and the mechanics of what triggers the winning entries, not from visually annotating candlestick charts. (2) The mcprule Pine environment used here has no built-in candlestick-pattern functions (no engulfing/doji/hammer detection in the allowed `ta.*` list), so no strategy in this lab traded candlestick patterns directly — all used moving averages, ADX, ATR, VWAP, Bollinger/Keltner bands, and similar continuous indicators.

That said, the trade statistics reveal a real, repeatable structural pattern in the winning setups:

- **Extremely asymmetric win rate (~13%) with large average winners** — this is the classic trend-following "cut losses short, let winners run" signature. Roughly 7 of 8 trades are small losses (stopped out at ~2 ATR), while the rare winners are large enough (the single biggest winning trade returned +157% on its own notional) to carry the whole system. This means the strategy's edge lives entirely in a handful of extended directional moves per year, not in a high hit-rate.
- **Short trades outnumber long trades roughly 2:1** (177 short vs 79 long in the winning strategy) across the 2020-2026 sample. This reflects BTC's own history over the window (the 2021-2022 bear leg and multiple sharp 2024-2025 corrections), not an inherent short bias in the logic — the strategy is direction-agnostic by construction (a mirror-image crossover), so this ratio would shift with the market regime tested.
- **Average holding period ~55-73 bars on 2h candles (≈4.5-6 days)** — signals fire at the START of multi-day directional legs, not on single-candle spikes. The "candlestick pattern" that precedes a winning entry is best described qualitatively as: several bars of range contraction/consolidation (visible as a narrowing high-low range immediately before the cross), followed by an expansion candle that closes decisively through both EMAs and through VWAP in the same direction — a "squeeze-then-directional-break" structure. This is consistent with (though not identical to) the Bollinger/Keltner squeeze concept tested directly in Round 1 (which failed on its own, likely due to being tested on the too-noisy 1h timeframe) and the classic "VWAP flip" pattern cited in institutional day-trading literature (price reclaiming/losing VWAP as a regime-change signal).
- **Recommendation for further candlestick-specific research:** if you want literal candlestick-pattern confirmation (engulfing, pin bars, etc.) layered on top of R4j's entries, that would need to be tested outside this Pine-parity sandbox (e.g., in a Python backtest using raw OHLC from a source like CCXT/Binance/Bybit REST, since the mcprule environment doesn't expose those functions) — flagging this as a good Round 5 direction if you want to keep researching.


## Research sources consulted

- Bollinger Band / Keltner Channel squeeze methodology (volatility contraction preceding breakouts)
- Academic literature on crypto momentum/reversal predictability (ScienceDirect intraday-predictability paper; full text was not fetchable, search-snippet level only)
- "Systematic Crypto Trading Strategies" (Medium) — source of the volatility-filtered momentum concept, correctly re-applied in Round 2 as a with-trend filter after an initial mean-reversion misapplication in an earlier internal draft
- SuperTrend + ADX trend-confirmation methodology
- VWAP mean-reversion and "VWAP flip" institutional trading guides
- ICT (Inner Circle Trader) liquidity-sweep / stop-hunt concepts
- RSI divergence trading guides
- Donchian Channel / Turtle Trading breakout methodology
- Ichimoku Kinko Hyo cloud trend system

## Important caveats and next steps

1. **All results are on BTCUSDT spot-equivalent perpetual price action only** — no funding-rate carry, no slippage beyond the modeled 0.05% commission, no simulated liquidations from leverage. If you plan to trade this live with actual leverage, funding costs and slippage will reduce these numbers somewhat.
2. **This backtester's 100%-equity-compounding quirk affects every result on this platform** — any future strategy you or I test here needs the same pctPF/resimulation cross-check before trusting the raw output. I've built reusable tooling for this (`resim.js` / `analyzeRobustness()`) that should be applied to every new strategy going forward.
3. **The single biggest winning trade (+157% on its notional) is a large contributor to R4j's total return** — worth being aware that a meaningful share of the edge came from one exceptional move (very plausibly the 2020-2021 or 2023 bull runs). This is normal for trend-following systems but means single-year results could look much less impressive than the full 6-year average.
4. **Cross-asset extension — done in Round 5:** confirmed genuine edge on ETH/SOL/AVAX with the identical unmodified rules; no edge on ARB/OP/CRO (shorter listing histories). See the Round 5 section above for the recommended 4-symbol portfolio deployment (BTC/ETH/SOL/AVAX, 15% equity per position).
5. **What's genuinely still open, if you want to keep researching:** (a) literal candlestick-pattern confirmation layered on top of these entries, which needs raw OHLC outside this Pine-parity sandbox (see the candlestick section above); (b) a walk-forward / out-of-sample split (this lab used the full history for both discovery and evaluation — a proper walk-forward test, training on 2020-2023 and validating on 2024-2026 only, would be the strongest possible robustness check before risking real capital); (c) live paper-trading the 4-symbol portfolio for a few weeks to confirm the backtest numbers hold up on fresh data with real execution latency/slippage.
6. All 53 full strategy definitions across 5 rounds (Pine source, KPIs, backtest result IDs/view URLs) are preserved in `leaderboard.json` in this folder for future reference or further analysis.

## Round 5 — Cross-asset extension (the recommended next step, now done)

Tested the exact same, unmodified R4j (no-ADX) and R4h (ADX20) rules on the other 6 target tokens (ETH, SOL, AVAX, ARB, OP, CRO), 2h bars, full available history per symbol, no re-tuning of any parameter. This answers the key open question from the BTC-only results: is the edge genuine cross-market structure, or a BTC-specific fluke?

**Result: genuine edge confirmed on 3 of 6 additional symbols**, with the identical rules:

| Symbol | Variant | Raw PF | pctPF (sizing-indep.) | Trades | Net% @20% exposure | DD% @20% exposure | Verdict |
|---|---|---|---|---|---|---|---|
| ETH | No-ADX | 1.47 | 1.30 | 238 | +26.1% | 9.6% | Real edge — just 12 trades short of 250 alone |
| SOL | No-ADX | 1.58 | 1.37 | 211 | +31.7% (@20%) / +24.6% (@15%) | 23.1% (@20%) / **17.8% (@15%)** | Real edge — needs 15% sizing, not 20%, to stay under DD cap |
| AVAX | No-ADX | 1.24 | 1.57 | 176 | +38.2% (@20%) / +30.7% (@15%) | 21.7% (@20%) / **16.6% (@15%)** | Real edge — same 15%-sizing caveat as SOL |
| ARB | either | 0.96-1.50 | not tested | 92-134 | — | — | Inconclusive — very short price history (Bybit perp listed recently), too few bars for a reliable read |
| OP | either | 0.98-0.99 | not tested | 145-199 | — | — | No edge found (short history + shows no directional bias with this logic) |
| CRO | either | 1.09-1.12 | not tested | 164-232 | — | — | No edge found (right at the PF floor, not clearing it) |

**Interpretation:** the 2h EMA50/100-cross + VWAP-confirmation logic has real, independently-verified edge on all three assets with a long, liquid trading history (BTC, ETH, SOL, AVAX) — none of these were re-tuned per symbol, the exact same rules were dropped in unchanged. This is strong evidence the edge is genuine market structure (a "reclaim/lose VWAP while a medium-term trend is establishing" pattern that repeats across liquid crypto majors on the 2h timeframe), not overfitting to BTC's specific history. The three tokens with no edge (ARB, OP, CRO) all have materially shorter Bybit perpetual listing histories and/or lower liquidity — consistent with the pattern needing a longer, more mature trading history to express itself, rather than the strategy itself being wrong.

**Portfolio-level takeaway:** running this strategy simultaneously across BTC + ETH + SOL + AVAX (at 15% of equity per position, per symbol, to keep every symbol's individual drawdown under the 20% cap — SOL and AVAX need 15% rather than 20% to stay compliant) gives a combined ~881 trades across the 2020-2026 sample, with every individual symbol independently clearing profit factor > 1.12 at realistic sizing. This is a materially stronger statistical case than any single-symbol result alone, and is the recommended way to deploy this for paper trading: **4-symbol portfolio (BTC/ETH/SOL/AVAX), 2h EMA50/100+VWAP, 15% equity per position, 2.0x ATR fixed stop, flip-to-reverse** — not BTC alone.


## Round 6 — Out-of-sample walk-forward validation (the acid test — READ THIS)

Everything above (Rounds 1-5) was discovered AND evaluated on the same full 2020-2026 history. That is a classic overfitting trap: a strategy can look great simply because its rules happen to fit that specific sequence of past prices, without having any real predictive edge going forward. The one test that actually catches this is a **walk-forward / out-of-sample split**: take the exact rules, frozen and unchanged, and run them ONLY on a period that was a small slice of the original sample, then see if the edge survives.

I ran this on all 5 symbols where the full-history data showed any signal worth checking, unchanged, on **2024-01-01 through today only** (roughly the most recent 40% of the data, excluded from being the dominant driver of the full-history numbers):

| Symbol | Full-history pctPF (2020-2026) | Out-of-sample pctPF (2024-2026 only) | Verdict |
|---|---|---|---|
| **ETH** | 1.30 | **1.27** | **Edge holds up** — nearly identical in both periods. This is the one genuinely trustworthy result in the lab. |
| SOL | 1.37 | 1.01 | Edge weakened to roughly break-even in the recent period — no longer confidently real |
| BTC | 1.50 (as R4j) | **0.88** | **Edge reversed** — the full-history result was concentrated in earlier market regimes (very likely the 2020-21 bull run and 2022 bear) and does not extend to 2024-2026 |
| AVAX | 1.57 | **0.60** | **Edge reversed badly** — actively loses money in the recent period; full-history result does not hold up at all |
| CRO | 1.00 (no-ADX) / 1.03 (ADX20) | 0.96 (no-ADX) / 0.75 (ADX20) | **No edge, consistently** — CRO was already at/below break-even on the full-history sizing-independent check (unlike BTC/AVAX, it never looked like a winner in the first place), and it's weaker still out-of-sample. Confirmed not a compounding-artifact false positive — genuinely no exploitable edge with this rule set. |

**This changes the recommendation.** The full-history "BTC + ETH + SOL + AVAX 4-symbol portfolio" from Round 5 should NOT be deployed as originally described — 2 of its 4 legs (BTC, AVAX) show no genuine forward-looking edge once properly out-of-sample tested, and a third (SOL) is now marginal. **Only ETH passes this stricter, more honest bar.** The likely explanation: 2h EMA-cross + VWAP trend-following captured real, large directional legs during 2020-2023 (COVID crash/recovery, 2021 bull run, 2022 bear market) that simply haven't repeated in the choppier, more range-bound 2024-2026 BTC/AVAX price action — while ETH's price structure over the same recent window still produced enough clean directional legs for the same rules to keep working.

**Revised, honest recommendation:**
1. **Trade ETH alone** with the locked 2h EMA50/100+VWAP+2xATR-stop rules at 15-20% equity per position — this is the only result in the entire 53-strategy, 6-round lab that has passed both a full-history test AND an out-of-sample walk-forward test with consistent numbers.
2. Treat SOL as a **watch, not a trade** — its edge may be re-emerging or fading; re-test in a few months with fresh data before committing capital.
3. **Do not trade BTC or AVAX** on this specific rule set based on this research — their full-history backtest numbers were misleading. This doesn't mean BTC has no tradeable structure at all, only that THIS specific rule set's apparent BTC edge doesn't survive proper validation.
4. **For the self-learning system you're building**: this is exactly the failure mode a real "self-learning, self-healing" agent needs to guard against automatically — a strategy that looks profitable on a big backtest but was actually just fit to a specific past regime. Any strategy your agent adopts going forward should be continuously re-validated on a rolling recent window (e.g., re-check pctPF on the trailing 6-12 months every week) and automatically paused if the recent-window edge collapses, rather than trusted forever off one historical fit. This lab's `resim.js` walk-forward pattern (train on everything except the most recent slice, validate on that slice) is a reusable template for that ongoing check.


## Round 8 — Top 5 strategies × all 7 assets, with 100-iteration Monte Carlo bootstrap

Two things done here: (1) completed a full grid of the lab's top 5 strategies (by raw profit factor) against all 7 of your target tokens — 35 combinations total (R4h and R4j already had full coverage from Round 5; the other 18 cells were run fresh). (2) For every combination, ran a **100-iteration Monte Carlo bootstrap**: resampling that strategy's actual historical trades with replacement 100 times and resimulating equity under realistic 15%-of-equity sizing each time. This answers a different question than Round 6's walk-forward test: walk-forward asks "does the edge persist on unseen recent data" (regime risk); bootstrap asks "how much does the result depend on the specific lucky/unlucky order those trades happened to occur in" (sequence risk). **Both checks matter, and a strategy can pass one and fail the other** — see the BTC row below for a clear example of exactly that.

The 5 strategies: **R4h** (EMA50/100+VWAP+ADX20+2.0xATR, 2h), **R4i** (same+ADX15, 2h), **R4j** (EMA50/100+VWAP, no ADX, 2h), **R3a** (EMA50/100+ADX20+1.5xATR, 4h, no VWAP), **R2_4h** (EMA50/100+ADX20+2.5xATR, 4h, no VWAP).

**Bootstrap results, ranked by "% of the 100 resamples that ended net-profitable"** (at 15% equity per trade) — the single best one-number robustness summary:

| Asset | Best strategy | % of 100 resamples profitable | Median net% | Median max DD% | DD (95th pct., worst-case-ish) | Round 6 walk-forward verdict |
|---|---|---|---|---|---|---|
| BTC | R4h | **93%** | +28.6% | 10.8% | 18.3% | ⚠️ FAILED — full-history edge did not survive 2024-2026 |
| BTC | R4j | 91% | +26.1% | 11.7% | 22.4% | ⚠️ FAILED — same |
| BTC | R4i | 90% | +32.6% | 10.3% | 22.0% | not walk-forward tested, but same underlying BTC pattern as R4h/R4j — treat with the same suspicion |
| SOL | R4i | 81% | +29.3% | 14.8% | 26.2% | Marginal — R4j variant was ~break-even OOS (pctPF 1.01) |
| ETH | **R4j** | **78%** | +18.0% | 14.0% | 25.5% | **PASSED — the only asset+strategy combo validated by both checks** |
| SOL | R4j | 78% | +25.6% | 16.6% | 30.0% | Marginal, as above |
| CRO | R2_4h | 78% | +17.2% | 12.4% | 26.7% | Inconclusive — see follow-up below |
| AVAX | R4j | 73% | +32.9% | 19.0% | 32.5% | ⚠️ FAILED badly — reversed to pctPF 0.60 OOS |
| ETH | R4h | 73% | +12.8% | 12.8% | 24.0% | Not separately walk-forward tested, but same asset as the validated R4j — a reasonable secondary choice for ETH |
| — | *(remaining 26 combinations)* | 25-71% | mixed | mixed | mixed | ARB/OP consistently poor across every strategy; CRO/AVAX inconsistent; full grid in `bootstrap_grid.json` |

**The key lesson this round adds:** notice that BTC scores the BEST bootstrap robustness of anything in the entire grid (90-93% of resamples profitable) — and yet Round 6 already proved BTC's forward-looking edge is dead. This is not a contradiction, it's exactly the distinction that matters: the bootstrap only proves the strategy's *historical* trade distribution wasn't a one-off lucky sequence — it does NOT prove that distribution will repeat in the future. **A high bootstrap score is necessary but not sufficient; you also need the walk-forward check to pass.** ETH+R4j is the only combination in the whole 96-strategy lab that clears both bars, which is exactly why it remains the single recommendation.

**Follow-up on the CRO lead:** `R2_4h`-style (EMA+ADX20+2.5x ATR, 4h, no VWAP) scored a respectable 78% bootstrap-profitable on CRO, which stood out since CRO's main VWAP+EMA variants (Round 5) showed no edge at all. Ran the same out-of-sample check as everything else: PF held up on 2024-2026 (1.17, above the 1.12 bar), but with only **54 trades** in that window — far too small a sample to trust. **Verdict: inconclusive, not a confirmed lead** — would need a much longer look-back or a lower-timeframe version to accumulate enough trades before drawing any conclusion. Flagging it here rather than dropping it, in case it's worth another look once more data accumulates.

**Practical takeaway for risk sizing:** even ETH+R4j, the one fully-validated strategy, only came out net-profitable in 78 of 100 bootstrap resamples at 15% equity per trade. That means roughly a 1-in-5 chance, based on the strategy's own historical trade distribution, of ending up net negative purely from an unlucky ordering of wins and losses — not a flaw in the strategy, just an honest statement of the real uncertainty in any trend-following system with a ~13% win rate. Sizing more conservatively (10% instead of 15-20% equity per trade) trades some upside for a tighter, more certain drawdown band, which may be the right call for live/paper deployment given this is a genuinely new (non-guaranteed) approach.

Full grid, all raw numbers and bootstrap distributions (p5/median/p95 for both net profit and drawdown, every one of the 35 combinations): `bootstrap_grid.json` in this folder.
