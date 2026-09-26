const lb = require('./leaderboard.json');
const e = lb.find(x => x.id === 'R5_ETH_2h_VWAP_EMA_NoADX');
console.log('resultId:', e.resultId, 'viewUrl:', e.viewUrl);
console.log(e.pineSource);
