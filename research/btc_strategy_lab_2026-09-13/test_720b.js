const tk = require('../../src/data/tradingKitFeed');
(async () => {
  try {
    const r = await tk.mcpCallRaw ? await tk.mcpCallRaw('plan_backtest_window', { symbol: 'ETHUSDT', timeframe: '720', fromTs: Date.now() - 86400000*400, toTs: Date.now() }) : 'no mcpCallRaw export';
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log('THROWN:', e.message);
  }
})();
