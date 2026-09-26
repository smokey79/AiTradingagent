const tk = require('../../src/data/tradingKitFeed');
(async () => {
  try {
    const r = await tk.planBacktestWindow('ETHUSDT', '720', Date.now() - 86400000*400, Date.now());
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('THROWN:', e.message);
  }
})();
