// Backtest: 3-candle RSI/VWAP/EMA14-50 strategy on Bitget PUBLIC candles (no API keys used).
// Usage: node scripts\backtest_3candle_2026-09-30.js
// Conservative rules: entry at candle-3 close, if stop and target hit in same candle -> counts as a LOSS,
// cost 0.15% per side (same as the duel paper book), one open trade per symbol.
const fs = require('fs'); const path = require('path'); const ccxt = require('ccxt');
// BT_STRAT=sweep -> Sweep & Engulf strategy; default -> original 3-candle RSI/VWAP/EMA strategy
const S = require(process.env.BT_STRAT === 'sweep' ? '../src/strategies/sweepEngulf' : '../src/strategies/threeCandleRsiVwapEma');
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'BNB/USDT', 'ADA/USDT', 'LINK/USDT'];
// Override with env vars, e.g.  $env:BT_TF='4h'; $env:BT_DAYS='365'
const TF_MINS = { '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
const TIMEFRAMES = Object.fromEntries((process.env.BT_TF || '15m,1h').split(',').map(t => [t.trim(), TF_MINS[t.trim()]]));
const DAYS = Number(process.env.BT_DAYS || 90); const COST = 0.0015;

async function fetchAll(ex, sym, tf, mins) {
  let since = Date.now() - DAYS * 864e5; const out = [];
  while (since < Date.now() - mins * 6e4) {
    const batch = await ex.fetchOHLCV(sym, tf, since, 200);
    if (!batch.length) break;
    for (const [t, o, h, l, c, v] of batch) if (!out.length || t > out[out.length - 1].t) out.push({ t, o, h, l, c, v });
    since = batch[batch.length - 1][0] + mins * 6e4;
    await new Promise(r => setTimeout(r, ex.rateLimit));
  }
  return out;
}

// Variant A = exactly as specified (1.5R). Variant B = same, but skips setups whose stop is so tight
// that the 0.3% round-trip cost eats most of the edge (stop distance must be >= 0.6% of price).
const VARIANTS = S.VARIANTS || { 'A as specified 1.5R': { ...S.DEFAULTS }, 'B fee-aware 1.5R (stop>=0.6%)': { ...S.DEFAULTS, minRiskPct: 0.006 } };

function simulate(candles, params) {
  const ind = S.indicators(candles, params); const trades = [];
  for (let i = 0; i < candles.length - 1; i++) {
    const sig = S.signalAt(candles, ind, i, params); if (!sig) continue;
    let exit = null, j = i + 1;
    for (; j < candles.length; j++) {
      const k = candles[j];
      const hitStop = sig.side === 'long' ? k.l <= sig.stop : k.h >= sig.stop;
      const hitTgt = sig.side === 'long' ? k.h >= sig.target : k.l <= sig.target;
      if (hitStop) { exit = sig.stop; break; } if (hitTgt) { exit = sig.target; break; }
    }
    if (exit == null) break; // still open at end of data -> ignore
    const gross = sig.side === 'long' ? exit / sig.entry - 1 : 1 - exit / sig.entry;
    const riskPct = Math.abs(sig.entry - sig.stop) / sig.entry;
    const net = gross - 2 * COST;
    trades.push({ t: new Date(candles[i].t).toISOString(), side: sig.side, entry: sig.entry, exit, netPct: net, R: net / riskPct, bars: j - i });
    i = j; // one trade at a time
  }
  return trades;
}

function stats(trades) {
  const n = trades.length; if (!n) return { n: 0 };
  const wins = trades.filter(t => t.netPct > 0); const gw = wins.reduce((a, t) => a + t.netPct, 0);
  const gl = -trades.filter(t => t.netPct <= 0).reduce((a, t) => a + t.netPct, 0);
  let eq = 1, peak = 1, dd = 0; for (const t of trades) { eq *= 1 + t.netPct; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  return { n, winRate: wins.length / n, avgR: trades.reduce((a, t) => a + t.R, 0) / n, profitFactor: gl ? gw / gl : null, totalPct: eq - 1, maxDD: dd };
}

(async () => {
  const ex = new ccxt.bitget({ enableRateLimit: true, options: { defaultType: 'spot' } });
  const report = { strategy: '3-candle RSI/VWAP/EMA14-50', days: DAYS, costPerSide: COST, generated: new Date().toISOString(), results: {} };
  const pct = x => (x * 100).toFixed(1) + '%';
  const cacheDir = path.join(__dirname, '..', 'data', 'backtests', 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const data = {};
  for (const [tf, mins] of Object.entries(TIMEFRAMES)) for (const sym of SYMBOLS) {
    const cf = path.join(cacheDir, `${sym.replace('/', '')}_${tf}_${DAYS}d.json`);
    try {
      if (fs.existsSync(cf) && Date.now() - fs.statSync(cf).mtimeMs < 6 * 36e5) data[`${tf} ${sym}`] = JSON.parse(fs.readFileSync(cf));
      else { data[`${tf} ${sym}`] = await fetchAll(ex, sym, tf, mins); fs.writeFileSync(cf, JSON.stringify(data[`${tf} ${sym}`])); }
      console.log(`data ${tf} ${sym}: ${data[`${tf} ${sym}`].length} candles`);
    } catch (e) { console.log(`data ${tf} ${sym} ERROR ${e.message.slice(0, 80)}`); }
  }
  for (const [vname, params] of Object.entries(VARIANTS)) {
    console.log(`\n##### ${vname}`);
    for (const tf of Object.keys(TIMEFRAMES)) {
      const all = [];
      for (const sym of SYMBOLS) {
        const candles = data[`${tf} ${sym}`]; if (!candles) continue;
        const tr = simulate(candles, params); all.push(...tr); const s = stats(tr);
        report.results[`${vname} | ${tf} ${sym}`] = s;
        console.log(`${tf.padEnd(4)} ${sym.padEnd(10)} trades ${String(s.n).padStart(3)}` + (s.n ? ` win ${pct(s.winRate)} avgR ${s.avgR.toFixed(2)} PF ${s.profitFactor ? s.profitFactor.toFixed(2) : '-'} total ${pct(s.totalPct)}` : ''));
      }
      all.sort((a, b) => a.t.localeCompare(b.t)); const s = stats(all); report.results[`${vname} | ${tf} ALL`] = s;
      console.log(`== ${tf} ALL: trades ${s.n}` + (s.n ? `, win ${pct(s.winRate)}, avg ${s.avgR.toFixed(2)}R, PF ${s.profitFactor ? s.profitFactor.toFixed(2) : '-'}, max DD ${pct(s.maxDD)}` : ''));
    }
  }
  const dir = path.join(__dirname, '..', 'data', 'backtests'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `3candle_${Date.now()}.json`); fs.writeFileSync(f, JSON.stringify(report, null, 2)); console.log('saved', f);
})();
