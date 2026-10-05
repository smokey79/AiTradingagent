// diag_bitget_key_env_2026-09-30.js — READ-ONLY: is the key in Downloads\bitget_demo_API.env a LIVE key or a DEMO key?
// Fetches balances only (no orders). Never prints key/secret/passphrase.
const fs = require('fs'); const ccxt = require('ccxt');
const lines = fs.readFileSync('C:\\Users\\barcl\\Downloads\\bitget_demo_API.env', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const all = lines.join('\n');
const key = all.match(/bg_[0-9a-f]{32}/i)[0], secret = all.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i)[0];
const pl = lines.find(l => /pass/i.test(l));
const pass = pl.replace(/^.*?pass\s*phrase\s*[:=\-\s]*/i, '').trim();
(async () => {
  const ex = new ccxt.bitget({ apiKey: key, secret, password: pass });
  for (const type of ['spot', 'swap']) {
    try { const b = await ex.fetchBalance({ type }); console.log(`LIVE ${type}: OK (key is a LIVE-account key) non-zero assets: ${Object.keys(Object.fromEntries(Object.entries(b.total || {}).filter(([, v]) => v > 0))).join(',') || 'none'}`); }
    catch (e) { console.log(`LIVE ${type}: FAIL ${String(e.message).replace(/\{.*"msg":"([^"]+)".*\}/, '$1').slice(0, 110)}`); }
  }
})();
