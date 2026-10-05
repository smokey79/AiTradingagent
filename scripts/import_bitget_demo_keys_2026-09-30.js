// import_bitget_demo_keys_2026-09-30.js — reads Alan's C:\Users\barcl\Downloads\bitget_demo_API.env (label+value lines),
// extracts API key (bg_ + 32 hex), secret (64 hex) and passphrase, tests them READ-ONLY against Bitget DEMO trading,
// and ONLY if the test passes saves them to F:\aitradingagent\.env as BITGET_DEMO_API_KEY / _SECRET / _PASSPHRASE
// (backing .env up first). Never prints any value. Places no orders.
const fs = require('fs'), path = require('path');
const ccxt = require('ccxt');
const src = 'C:\\Users\\barcl\\Downloads\\bitget_demo_API.env';
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const all = lines.join('\n');
const key = (all.match(/bg_[0-9a-f]{32}/i) || [])[0];
const secret = (all.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i) || [])[0];
const passLine = lines.find(l => /pass/i.test(l)) || '';
const stripped = passLine.replace(/^.*?pass\s*phrase\s*[:=\-\s]*/i, '').replace(/^.*?password\s*[:=\-\s]*/i, '').trim();
const passCandidates = [...new Set([stripped, passLine.trim(), passLine.split(/[\s:=]+/).pop()].filter(Boolean))];
console.log(`found: api key ${key ? 'yes' : 'NO'}, secret ${secret ? 'yes' : 'NO'}, passphrase candidates ${passCandidates.length}`);
if (!key || !secret || !passCandidates.length) process.exit(2);

(async () => {
  for (const [i, pass] of passCandidates.entries()) {
    const ex = new ccxt.bitget({ apiKey: key, secret, password: pass });
    ex.enableDemoTrading(true);
    const res = {};
    for (const type of ['swap', 'spot']) {
      try { const b = await ex.fetchBalance({ type }); res[type] = 'OK ' + JSON.stringify(Object.fromEntries(Object.entries(b.total || {}).filter(([, v]) => v > 0))); }
      catch (e) { res[type] = 'FAIL ' + String(e.message).replace(/\{.*"msg":"([^"]+)".*\}/, '$1').slice(0, 110); }
    }
    console.log(`passphrase candidate ${i + 1}: swap ${res.swap} | spot ${res.spot}`);
    if (/^OK/.test(res.swap) || /^OK/.test(res.spot)) {
      const envPath = path.resolve(__dirname, '..', '.env');
      fs.copyFileSync(envPath, `${envPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      let lines2 = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      const set = { BITGET_DEMO_API_KEY: key, BITGET_DEMO_SECRET: secret, BITGET_DEMO_PASSPHRASE: pass };
      for (const [k, v] of Object.entries(set)) { const j = lines2.findIndex(l => l.startsWith(k + '=')); if (j >= 0) lines2[j] = `${k}=${v}`; else lines2.push(`${k}=${v}`); }
      fs.writeFileSync(envPath, lines2.join('\r\n'));
      console.log('SAVED to .env as BITGET_DEMO_API_KEY / BITGET_DEMO_SECRET / BITGET_DEMO_PASSPHRASE (backup made)');
      return process.exit(0);
    }
  }
  console.log('No combination worked — nothing saved.');
  process.exit(1);
})();
