const lb = require('./leaderboard.json');
const ids = ['R4j_2h_VWAP_EMA_NoADX', 'R4h_2h_VWAP_EMA_Confluence', 'R4d_2h_ATRstop2_5x', 'R3c_2h_SameLogic', 'R4b_2h_ADX25'];
for (const id of ids) {
  const e = lb.find(x => x.id === id);
  if (!e) { console.log(id, 'NOT FOUND'); continue; }
  console.log('---', id, '---');
  console.log('longTrades:', e.longTrades, 'shortTrades:', e.shortTrades);
  console.log('avgBarsInTrade:', e.avgBarsInTrade, 'avgTradePct:', e.avgTradePct);
  console.log('winRatePct:', e.winRatePct, 'sharpe:', e.sharpeRatio, 'sortino:', e.sortinoRatio);
  console.log('viewUrl:', e.viewUrl);
}
