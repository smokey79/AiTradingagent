// Re-tests the Bitget DEMO key from Downloads\bitget_demo_API.env and, ONLY if it works,
// backs up .env and writes BITGET_DEMO_API_KEY / BITGET_DEMO_SECRET / BITGET_DEMO_PASSPHRASE.
// Never prints key values. Live BITGET_* keys are left untouched.
const fs = require('fs'); const path = require('path'); const ccxt = require('ccxt');
const SRC = 'C:\\Users\\barcl\\Downloads\\bitget_demo_API.env';
const ENV = path.join(__dirname, '..', '.env');
const txt = fs.readFileSync(SRC, 'utf8');
const key = (txt.match(/bg_[0-9a-f]{32}/i) || [])[0];
const secret = (txt.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i) || [])[0];
const passLine = txt.split(/\r?\n/).find(l => /pass/i.test(l)) || '';
const pass = passLine.replace(/^.*?pass\s*phrase/i, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
(async () => {
  if (!key || !secret || !pass) { console.log('missing key/secret/passphrase in file — nothing saved'); return; }
  const ex = new ccxt.bitget({ apiKey: key, secret, password: pass, options: { defaultType: 'swap' } });
  ex.enableDemoTrading(true);
  try { await ex.fetchBalance({ type: 'swap' }); } catch (e) { console.log('demo test FAILED — nothing saved'); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(ENV, `${ENV}.bak-${stamp}`);
  let env = fs.readFileSync(ENV, 'utf8');
  const set = (k, v) => { const re = new RegExp(`^${k}=.*$`, 'm'); env = re.test(env) ? env.replace(re, `${k}=${v}`) : env.replace(/\s*$/, `\n${k}=${v}\n`); };
  set('BITGET_DEMO_API_KEY', key); set('BITGET_DEMO_SECRET', secret); set('BITGET_DEMO_PASSPHRASE', pass); set('BITGET_DEMO_ENABLED', 'true');
  fs.writeFileSync(ENV, env);
  console.log(`demo test OK — saved BITGET_DEMO_* to .env (backup .env.bak-${stamp})`);
})();
