// scripts/engine_train.js (2026-10-03) -- download real 1h history (public data, Bitget via ccxt), train the multi-horizon model, test it out-of-sample,
// write data/engine/model.json + data/engine/train_report.json, and print an honest summary.
// Usage: node scripts/engine_train.js [--refresh] [--candles 2000] [--pairs BTC/USDT,ETH/USDT]
// Nothing here places an order. A model that fails its out-of-sample bar is still saved, but marked validated:false (the gate then stays in shadow).
'use strict';
const fs = require('fs');
const path = require('path');
const { trainModel } = require('../src/engine/trainer');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'engine.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const want = Number(val('--candles', cfg.train.candles));
const pairs = (val('--pairs', '') ? val('--pairs').split(',') : cfg.train.pairs).map((s) => s.trim());
const cacheDir = path.join(ROOT, 'data', 'engine', 'history');
fs.mkdirSync(cacheDir, { recursive: true });

async function fetchHistory(ex, pair) {
  const file = path.join(cacheDir, pair.replace('/', '_') + '_1h.json');
  if (!flag('--refresh') && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600000) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let since = Date.now() - want * 3600000, all = [];
  for (let page = 0; page < 6 && since < Date.now() - 3600000; page++) {
    const rows = await ex.fetchOHLCV(pair, '1h', since, 1000);
    if (!rows.length) break;
    all = all.concat(rows);
    const last = rows[rows.length - 1][0];
    if (last <= since) break;
    since = last + 3600000;
  }
  const seen = new Set(), out = all.filter((r) => (seen.has(r[0]) ? false : seen.add(r[0]))).sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

(async () => {
  const ccxt = require('ccxt');
  const ex = new ccxt.bitget({ enableRateLimit: true, timeout: 20000 });
  await ex.loadMarkets();
  const series = {};
  for (const p of pairs) {
    try {
      const c = await fetchHistory(ex, p);
      if (c.length >= 400) { series[p] = c; console.log(`${p.padEnd(10)} ${c.length} candles  ${new Date(c[0][0]).toISOString().slice(0, 10)} -> ${new Date(c[c.length - 1][0]).toISOString().slice(0, 10)}`); }
      else console.log(`${p.padEnd(10)} skipped (${c.length} candles)`);
    } catch (e) { console.log(`${p.padEnd(10)} failed: ${e.message.slice(0, 80)}`); }
  }
  if (Object.keys(series).length < 3) { console.error('need at least 3 coins with history'); process.exit(1); }

  const t0 = Date.now();
  const model = trainModel(series, cfg);
  fs.writeFileSync(path.join(ROOT, 'data', 'engine', 'model.json'), JSON.stringify(model));
  const report = { trainedAt: model.trainedAt, data: model.data, primaryHorizonH: model.primaryHorizonH, validated: model.validated, recommendedMinProb: model.recommendedMinProb, horizons: Object.fromEntries(Object.entries(model.horizons).map(([h, b]) => [h, b.validation])) };
  fs.writeFileSync(path.join(ROOT, 'data', 'engine', 'train_report.json'), JSON.stringify(report, null, 2));

  console.log(`\ntrained in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${model.data.pairs} coins / ${model.data.candles} candles`);
  const pct = (x) => (x == null ? '-' : (x * 100).toFixed(3) + '%');
  for (const [h, b] of Object.entries(model.horizons)) {
    const v = b.validation, ts = v.testSignals, all = v.testAllEdgeSignals;
    console.log(`\n=== horizon ${h}h | train ${v.nTrain} / calib ${v.nCalib} / test ${v.nTest} (test from ${v.testFrom.slice(0, 10)})`);
    console.log(`  base rates down/flat/up: ${(v.baseRates.down * 100).toFixed(1)}% / ${(v.baseRates.flat * 100).toFixed(1)}% / ${(v.baseRates.up * 100).toFixed(1)}%`);
    console.log(`  Brier ${v.brier} vs base-rate Brier ${v.brierBase}  -> skill ${(v.brierSkill * 100).toFixed(2)}% (positive = better than guessing the base rates)`);
    console.log(`  expected-return slope ${v.slope} (+/- ${v.slopeSe}); 1.0 would mean the raw forecast is perfectly scaled, 0 means it carries no information`);
    console.log(`  signals taken by the edge rule alone (any probability), test slice: ${all.n} trades, mean net ${pct(all.mean)}, t ${all.t.toFixed(2)}`);
    console.log(`  chosen probability threshold (picked on the calibration slice): ${v.chosenThreshold ?? 'none'}`);
    if (ts) console.log(`  TEST at that threshold: ${ts.n} trades, mean net ${pct(ts.mean)}, win ${(ts.winRate * 100).toFixed(1)}%, PF ${ts.profitFactor.toFixed(2)}, t ${ts.t.toFixed(2)}, max drawdown ${pct(ts.maxDrawdown)}`);
    console.log(`  VALIDATED: ${v.validated}${v.validated ? '' : '  because: ' + v.failReasons.join('; ')}`);
  }
  console.log(`\nprimary horizon ${model.primaryHorizonH}h validated: ${model.validated}  -> gate mode will be ${model.validated ? 'allowed to enforce (auto)' : 'shadow only'}`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
