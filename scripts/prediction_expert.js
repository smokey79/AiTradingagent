'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('../src/utils/privateEnv').loadApiDefaults();
const fs = require('fs');
const path = require('path');
const { fetchHorizonCandles } = require('../src/engine/horizonData');
const { enrich } = require('../src/learning/expertContext');
const engine = require('../src/engine/engine');
const memory = require('../src/learning/expertMemory');
const cfg = require('../config/engine.json');
const { spawn } = require('child_process');
let running = false, training = false;
const directory = path.resolve(__dirname, '../data/expert');

function trainingDue() {
  const file = path.resolve(__dirname, '../data/engine/train_report.json');
  return !fs.existsSync(file) || Date.now() - fs.statSync(file).mtimeMs > 86400000;
}
function retrain() {
  if (training || !trainingDue()) return;
  training = true;
  const child = spawn(process.execPath, [path.join(__dirname, 'train_prediction_expert.js')], { cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'ignore' });
  const deadline = setTimeout(() => child.kill(), 10 * 60000);
  child.once('error', () => { training = false; clearTimeout(deadline); });
  child.once('exit', () => { training = false; clearTimeout(deadline); });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const pairs = (process.env.TRADING_PAIRS || cfg.train.pairs.join(',')).split(',').map(s => s.trim()).filter(s => /\/USDT$/.test(s));
    const results = {};
    for (const pair of pairs) {
      const horizonCandles = await fetchHorizonCandles(pair);
      const latest = horizonCandles['5m']?.at(-1) || horizonCandles['1h']?.at(-1);
      if (!latest) { results[pair] = { status: 'data_unavailable' }; continue; }
      const md = enrich(pair, { candles: horizonCandles['1h'], horizonCandles, price: { price: latest[4] }, indicators: {}, quality: { ok: true } });
      const prediction = await engine.evaluate({ pair, marketData: md, consensus: { signal: 'HOLD' } });
      results[pair] = { ...prediction, patternAdvice: md.patternAdvice, sourceEvidence: md.sourceEvidence, sharedLearning: md.learningContext };
    }
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'latest.json'), tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), advisoryOnly: true, aiBudget: memory.budget(), results }, null, 2));
    fs.renameSync(tmp, file);
    if (!process.argv.includes('--once')) retrain();
  } finally { running = false; }
}
module.exports = { tick };
if (require.main === module) {
  tick().catch(() => console.error('Prediction expert cycle unavailable; will retry.'));
  if (!process.argv.includes('--once')) setInterval(() => tick().catch(() => console.error('Prediction expert cycle unavailable; will retry.')), 300000);
}
