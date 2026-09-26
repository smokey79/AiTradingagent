const tk = require('../../src/data/tradingKitFeed');
(async () => {
  const r = await tk.mcpCall('plan_backtest_window', { symbol: 'ETHUSDT', timeframe: '720', from: Date.now() - 86400000*400, to: Date.now() });
  console.log('RESULT:', JSON.stringify(r, null, 2));
})();
