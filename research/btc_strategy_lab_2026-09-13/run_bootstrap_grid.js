const fs = require('fs');
const path = require('path');
const { bootstrapAnalyze } = require('./bootstrap.js');

const lb = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaderboard.json'), 'utf8'));

const TICKERS = ['BTC', 'ETH', 'SOL', 'AVAX', 'ARB', 'OP', 'CRO'];
const SYM = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', AVAX: 'AVAXUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT', CRO: 'CROUSDT' };

// Map each of the "top 5" strategies to how to find its leaderboard entry
// per ticker (BTC used a different id-naming convention from rounds 1-4).
function findEntry(strategyKey, ticker) {
  const idMap = {
    R4h: ticker === 'BTC' ? 'R4h_2h_VWAP_EMA_Confluence' : `R5_${ticker}_2h_VWAP_EMA_ADX20`,
    R4i: ticker === 'BTC' ? 'R4i_2h_VWAP_EMA_ADX15' : `R8_${ticker}_2h_VWAP_EMA_ADX15`,
    R3a: ticker === 'BTC' ? 'R3a_4h_TighterStop' : `R8_${ticker}_4h_ADX20_1_5xATR`,
    R4j: ticker === 'BTC' ? 'R4j_2h_VWAP_EMA_NoADX' : `R5_${ticker}_2h_VWAP_EMA_NoADX`,
    R2_4h: ticker === 'BTC' ? 'R2_4h_TrendFollow_ADX' : `R8_${ticker}_4h_ADX20_2_5xATR`,
  };
  return lb.find((e) => e.id === idMap[strategyKey]);
}

const STRATEGIES = ['R4h', 'R4i', 'R3a', 'R4j', 'R2_4h'];

(async () => {
  const out = {};
  for (const strat of STRATEGIES) {
    out[strat] = {};
    for (const ticker of TICKERS) {
      const entry = findEntry(strat, ticker);
      if (!entry || !entry.resultId) { out[strat][ticker] = { skipped: true }; continue; }
      process.stdout.write(`bootstrapping ${strat} x ${ticker} (${entry.totalTrades} trades)... `);
      try {
        const res = await bootstrapAnalyze(entry.resultId, 0.15, 100);
        out[strat][ticker] = { ...res, rawPF: entry.profitFactor, rawTrades: entry.totalTrades };
        console.log(`median net=${res.netProfitPct.median.toFixed(1)}% median DD=${res.maxDrawdownPct.median.toFixed(1)}% (DD p95=${res.maxDrawdownPct.p95.toFixed(1)}%) profitable=${(res.pctIterationsProfitable*100).toFixed(0)}%`);
      } catch (e) {
        console.log('ERROR', e.message);
        out[strat][ticker] = { error: e.message };
      }
    }
  }
  fs.writeFileSync(path.join(__dirname, 'bootstrap_grid.json'), JSON.stringify(out, null, 2));
  console.log('DONE');
})();
