const lb = require('./leaderboard.json');
const ids = ['R4h_2h_VWAP_EMA_Confluence', 'R4i_2h_VWAP_EMA_ADX15', 'R3a_4h_TighterStop', 'R4j_2h_VWAP_EMA_NoADX', 'R2_4h_TrendFollow_ADX'];
for (const id of ids) {
  const e = lb.find(x => x.id === id);
  console.log('=====', id, 'symbol:', e.symbol, 'timeframe:', e.timeframe, 'PF:', e.profitFactor);
  console.log(e.pineSource);
  console.log('');
}
