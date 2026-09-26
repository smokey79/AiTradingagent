const S = require('./strategies');
const COINS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', AVAX: 'AVAXUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT', CRO: 'CROUSDT' };
// Intervals TradingKit accepts (probe 24 Sep 2026: 6h '360' and 12h '720' return null, which is
// why the 13 Sep 12h runs errored). Override with LAB_TIMEFRAMES="15m,1h" to run a subset.
const ALL_TF = { '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1D': 'D' };
const TF = process.env.LAB_TIMEFRAMES
  ? Object.fromEntries(process.env.LAB_TIMEFRAMES.split(',').map(k => [k.trim(), ALL_TF[k.trim()]]).filter(([, v]) => v))
  : ALL_TF;
const TF_ORDER = Object.keys(ALL_TF);
const batch = [];
for (const [strat, build] of Object.entries(S))
  for (const [coin, symbol] of Object.entries(COINS))
    for (const [tfLabel, tf] of Object.entries(TF))
      batch.push({ id: `MTF_${strat}_${coin}_${tfLabel}`, strat, coin, symbol, tfLabel, timeframe: tf,
                   pineSource: build(`${coin} ${tfLabel} ${strat}`) });
module.exports = { batch, COINS, TF_ORDER, STRATS: Object.keys(S) };
