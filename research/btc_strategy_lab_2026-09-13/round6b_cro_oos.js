// CRO out-of-sample check, matching the Round 6 walk-forward methodology
// applied to BTC/ETH/SOL/AVAX. CRO's full-history (Round 5) numbers were
// already weak (PF 1.09 no-ADX / 1.12 ADX20, right at or below the 1.12
// floor) -- this confirms whether that's consistent across the recent
// period too, or whether CRO deserves a second look.
const fs = require('fs');
const path = require('path');

const lb = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaderboard.json'), 'utf8'));

const WINNERS = ['R5_CRO_2h_VWAP_EMA_NoADX', 'R5_CRO_2h_VWAP_EMA_ADX20'];
const OOS_FROM = Date.UTC(2024, 0, 1);

const batch = WINNERS.map((id) => {
  const src = lb.find((e) => e.id === id);
  if (!src) throw new Error('missing leaderboard entry: ' + id);
  return {
    id: `${id}_OOS2024`,
    round: 6,
    symbol: src.symbol,
    timeframe: src.timeframe,
    fromTs: OOS_FROM,
    toTs: Date.now(),
    concept: `Out-of-sample walk-forward check: ${id}'s exact locked Pine source, unchanged, on 2024-01-01..now only`,
    hypothesis: 'CRO full-history PF was already weak (1.09-1.12); check whether it is consistently weak or possibly stronger in the recent regime.',
    pineSource: src.pineSource,
  };
});

module.exports = batch;
