'use strict';
const fs = require('fs');
const path = require('path');
const { trainModel } = require('../src/engine/trainer');
const { closedCandles, MINUTES } = require('../src/engine/horizonData');
const ROOT = path.resolve(__dirname, '..');
const cfg = require('../config/engine.json');
const directory = process.env.ENGINE_DATA_DIR || path.join(ROOT, 'data', 'engine');

async function history(ex, pair, timeframe, refresh = false) {
  const cacheDir = path.join(directory, 'history'); fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${pair.replace('/', '_')}_${timeframe}.json`);
  if (!refresh && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 3600000)
    return closedCandles(JSON.parse(fs.readFileSync(file, 'utf8')), timeframe);
  const step = MINUTES[timeframe] * 60000, count = timeframe === '1d' ? cfg.train.dailyCandles : cfg.train.candles;
  let since = Date.now() - count * step;
  const rows = [];
  for (let page = 0; page < Math.ceil(count / 500) + 3 && since < Date.now() - step; page++) {
    const next = await ex.fetchOHLCV(pair, timeframe, since, 500);
    if (!next.length || next.at(-1)[0] < since) break;
    rows.push(...next); since = next.at(-1)[0] + step;
  }
  const result = closedCandles(rows, timeframe);
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(result)); fs.renameSync(tmp, file);
  return result;
}

async function run({ refresh = false } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const exchange = new (require('ccxt').bitget)({ enableRateLimit: true, timeout: 12000 });
  const sets = {};
  for (const timeframe of [...new Set(Object.values(cfg.horizonTimeframes))]) {
    sets[timeframe] = {};
    for (const pair of cfg.train.pairs) {
      try {
        sets[timeframe][pair] = await history(exchange, pair, timeframe, refresh);
        console.log(`${pair} ${timeframe}: ${sets[timeframe][pair].length} closed candles`);
      } catch (_) { console.log(`${pair} ${timeframe}: history unavailable`); }
    }
  }
  const model = trainModel(sets, cfg);
  const active = process.env.ENGINE_MODEL_PATH || path.join(directory, 'model.json');
  const candidate = path.join(directory, 'candidate-model.json');
  fs.writeFileSync(candidate, JSON.stringify(model));
  let previous;
  try { previous = JSON.parse(fs.readFileSync(active, 'utf8')); } catch (_) { /* new model */ }
  const promoted = !!model.validated && (!previous?.validated || Date.parse(model.trainedAt) > Date.parse(previous.trainedAt));
  // Unvalidated candidates may provide shadow forecasts but never displace a validated model.
  if (promoted || !previous?.validated) {
    fs.mkdirSync(path.dirname(active), { recursive: true });
    if (fs.existsSync(active)) fs.copyFileSync(active, path.join(directory, `model-backup-${Date.now()}.json`));
    const tmp = `${active}.tmp`; fs.writeFileSync(tmp, JSON.stringify(model)); fs.renameSync(tmp, active);
  }
  const report = { trainedAt: model.trainedAt, promoted, validated: model.validated, horizons: Object.fromEntries(Object.entries(model.horizons).map(([h, b]) => [h, b.validation])) };
  const reportPath = path.join(directory, 'train_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ trained: true, promoted, horizonReadiness: Object.fromEntries(Object.entries(model.horizons).map(([h, b]) => [h, b.unavailable ? 'insufficient_history' : b.validation.validated ? 'validated' : 'shadow_only'])) }));
  return report;
}

module.exports = { run, history };
if (require.main === module) run({ refresh: process.argv.includes('--refresh') }).catch(() => { console.error('Training unavailable; current model retained.'); process.exitCode = 1; });
