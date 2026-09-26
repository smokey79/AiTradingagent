/** Runs ONE backtest (ETH 2h EMA_VWAP) to confirm get_trades returns timestamps for the OOS split. */
const tk = require('../../src/data/tradingKitFeed');
const S = require('./strategies');
(async () => {
  const plan = await tk.planBacktestWindow('ETHUSDT', '120', Date.UTC(2020, 2, 25), Date.now());
  const a = plan?.applied || {};
  const res = await tk.quickBacktest({ pineSource: S.EMA_VWAP('probe ETH 2h'), symbol: a.symbol || 'ETHUSDT', timeframe: '120',
    from: a.fromTs, to: a.toTs, name: 'MTF_probe', notes: 'multi_tf_lab probe' });
  console.log('keys:', Object.keys(res || {}).join(','), '| resultId:', res?.resultId, '| trades:', res?.result?.totalTrades, '| PF:', res?.result?.profitFactor);
  const r = await tk.mcpCall('get_trades', { jobId: res?.resultId });
  const trades = Array.isArray(r) ? r : (r?.trades || []);
  console.log('get_trades type:', Array.isArray(r) ? 'array' : typeof r, '| keys:', r && !Array.isArray(r) ? Object.keys(r).join(',') : '', '| n:', trades.length);
  if (trades[0]) console.log('trade fields:', Object.keys(trades[0]).join(','), '\nfirst:', JSON.stringify(trades[0]).slice(0, 400));
  process.exit(0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
