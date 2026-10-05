// Read-only diagnostic: tries passphrase variants against Bitget DEMO. Never prints secret values.
const fs = require('fs');
const ccxt = require('ccxt');
const FILE = 'C:\\Users\\barcl\\Downloads\\bitget_demo_API.env';
const txt = fs.readFileSync(FILE, 'utf8');
const key = (txt.match(/bg_[0-9a-f]{32}/i) || [])[0];
const secret = (txt.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i) || [])[0];
const passLine = txt.split(/\r?\n/).find(l => /pass/i.test(l)) || '';
const raw = passLine.replace(/^.*?pass\s*phrase/i, '').replace(/^.*?password/i, '');
const base = raw.replace(/^[\s:=\-"']+/, '').replace(/[\s"';,]+$/, '');
const variants = [...new Set([base, base.trim(), raw.trim(), base.split(/\s+/)[0], base.split(/\s+/).pop(), base.replace(/[^A-Za-z0-9]/g, ''), base.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')].filter(Boolean))];
// Where are the non-letter/number characters? (position only, never the value)
console.log('symbol positions in parsed passphrase:', [...base].map((ch, i) => /[^A-Za-z0-9]/.test(ch) ? (i === 0 ? 'first' : i === base.length - 1 ? 'last' : 'middle') : null).filter(Boolean).join(',') || 'none');
const desc = s => `len ${s.length}, upper ${/[A-Z]/.test(s)}, lower ${/[a-z]/.test(s)}, digit ${/\d/.test(s)}, symbol ${/[^A-Za-z0-9]/.test(s)}, space ${/\s/.test(s)}`;
console.log(`key found ${!!key}, secret found ${!!secret}, passphrase variants ${variants.length}`);
(async () => {
  for (const [i, p] of variants.entries()) {
    const ex = new ccxt.bitget({ apiKey: key, secret, password: p, options: { defaultType: 'swap' } });
    ex.enableDemoTrading(true);
    try { await ex.fetchBalance({ type: 'swap' }); console.log(`variant ${i + 1} (${desc(p)}): DEMO OK`); }
    catch (e) { console.log(`variant ${i + 1} (${desc(p)}): FAIL ${(String(e.message).match(/"msg":"([^"]*)"/) || [, String(e.message).slice(0, 80)])[1]}`); }
  }
})();
