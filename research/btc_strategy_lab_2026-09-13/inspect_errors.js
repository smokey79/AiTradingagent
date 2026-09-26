const lb = require('./leaderboard.json');
const ids = ['R7_ETH_12h_VWAP_EMA', 'R7_BTC_12h_VWAP_EMA'];
for (const id of ids) {
  const e = lb.find(x => x.id === id);
  console.log(id, JSON.stringify(e, null, 2).slice(0, 800));
}
