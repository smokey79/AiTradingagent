const fs = require('fs');
const path = require('path');
const lb = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaderboard.json'), 'utf8'));
const src = lb.find((e) => e.id === 'R8_CRO_4h_ADX20_2_5xATR');
module.exports = [{
  id: 'R8_CRO_4h_ADX20_2_5xATR_OOS2024',
  round: 8,
  symbol: src.symbol,
  timeframe: src.timeframe,
  fromTs: Date.UTC(2024, 0, 1),
  toTs: Date.now(),
  concept: 'Out-of-sample check on the CRO lead the bootstrap flagged (78% profitable resamples on full history)',
  hypothesis: 'Confirm whether this is real or another full-history-only artifact, consistent with the Round 6 methodology.',
  pineSource: src.pineSource,
}];
