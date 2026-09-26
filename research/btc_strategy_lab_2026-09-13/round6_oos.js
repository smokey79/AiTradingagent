// Round 6: out-of-sample walk-forward validation.
// Everything so far (rounds 1-5) was discovered AND evaluated on the same
// full 2020-2026 history -- the classic overfitting trap. This round takes
// the 4 winning strategies EXACTLY as locked (same Pine source, byte for
// byte, pulled straight from leaderboard.json -- zero re-tuning) and reruns
// them on 2024-01-01 through today ONLY, a period that was a small minority
// of the original discovery sample. If the edge holds up here, that's much
// stronger evidence it's real than the full-history number alone.
const fs = require('fs');
const path = require('path');

const lb = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaderboard.json'), 'utf8'));

const WINNERS = [
  'R4j_2h_VWAP_EMA_NoADX',        // BTC
  'R5_ETH_2h_VWAP_EMA_NoADX',
  'R5_SOL_2h_VWAP_EMA_NoADX',
  'R5_AVAX_2h_VWAP_EMA_NoADX',
];

const OOS_FROM = Date.UTC(2024, 0, 1); // 2024-01-01 00:00:00 UTC

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
    concept: `Out-of-sample walk-forward check: ${id}'s EXACT locked Pine source, unchanged, run on 2024-01-01..now only (excluded from the original full-history evaluation)`,
    hypothesis: 'If profit factor/edge holds up on this held-out period, the strategy is much less likely to be an artifact of fitting the full 2020-2026 sample.',
    pineSource: src.pineSource,
  };
});

module.exports = batch;
