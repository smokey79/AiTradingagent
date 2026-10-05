# Live order-book observational pilot

Actual recorded public depth sample rows: 13659. Fifty levels per side, sampled once per second. Executed buy/sell flow is recorded separately from resting depth.

|Market|Nonoverlapping5s predictions|Direction accuracy|Gross signed bps|After assumed costs bps|
|---|---:|---:|---:|---:|
|BTCUSDT|268|17.91%|0.0675|-15.9325|
|ETHUSDT|268|25.75%|0.0563|-15.9437|
|SOLUSDT|268|27.61%|0.1012|-19.8988|

The first60% fits a small linear model of depth imbalance, best-quote order-flow imbalance and executed trade imbalance; the later40% evaluates nonoverlapping approximate five-second moves. This short local sample does not establish a persistent edge, execution fills, stop behaviour, portfolio drawdown or a deployable strategy. Resting orders can be cancelled; venue-specific imbalance can conflict with other venues. Historical candles cannot reconstruct historical depth. The browser heatmap connects to a fresh public feed and places no orders.