// Resimulate R3c and R3g under realistic fixed-fractional position sizing
const fs = require('fs');
const path = require('path');
const { analyzeRobustness } = require('./resim.js');

const lbPath = path.join(__dirname, 'leaderboard.json');
const lb = JSON.parse(fs.readFileSync(lbPath, 'utf8'));

const targets = ['R5_CRO_2h_VWAP_EMA_NoADX', 'R5_CRO_2h_VWAP_EMA_ADX20'];

(async () => {
  const out = {};
  for (const name of targets) {
    const entry = lb.find(e => e.id === name);
    if (!entry) { console.log('NOT FOUND:', name); continue; }
    console.log('=== ', name, ' resultId=', entry.resultId, ' ===');
    try {
      const res = await analyzeRobustness(entry.resultId, [0.05, 0.10, 0.15, 0.20]);
      out[name] = res;
      console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      console.log('ERROR analyzing', name, e.message);
      out[name] = { error: e.message };
    }
  }
  fs.writeFileSync(path.join(__dirname, 'resim_candidates_r4.json'), JSON.stringify(out, null, 2));
  console.log('DONE');
})();
