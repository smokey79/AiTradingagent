// scripts/probe_new_coins.js - checks which public exchanges list each coin (no keys). 2026-09-24
// Run: node scripts/probe_new_coins.js
const COINS = ['LTC', 'TRX', 'ZEC', 'SUI', 'OKB', 'ICP', 'AAVE', 'POL', 'ATOM', 'FLR'];
const ok = async (url, test) => { try { const r = await fetch(url); const j = await r.json(); return test(j); } catch { return false; } };
(async () => {
  for (const c of COINS) {
    const binance = await ok(`https://api.binance.com/api/v3/klines?symbol=${c}USDT&interval=1d&limit=1`, j => Array.isArray(j) && j.length > 0);
    const bybit = await ok(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${c}USDT&interval=D&limit=1`, j => j.retCode === 0 && j.result?.list?.length > 0);
    const okx = await ok(`https://www.okx.com/api/v5/market/candles?instId=${c}-USDT&bar=1D&limit=1`, j => j.code === '0' && j.data?.length > 0);
    console.log(`${c.padEnd(5)} binance=${binance} bybit=${bybit} okx=${okx}`);
  }
})();
