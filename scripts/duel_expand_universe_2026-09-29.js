// duel_expand_universe_2026-09-29.js — Alan: "any market is allowed" for the duel.
// Adds ONLY the markets that duel_universe_probe_2026-09-29.js confirmed have live prices, to the SHARED universe
// both bots read (TRADING_PAIRS in .env + config/instrument_universe.json). Backs up both files first.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const probe = JSON.parse(fs.readFileSync(path.join(root, 'runs/2026-09-29_duel/universe_probe.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

// 1) .env TRADING_PAIRS (crypto) — append, never remove/reorder
const envPath = path.join(root, '.env');
fs.copyFileSync(envPath, `${envPath}.bak-${stamp}`);
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const i = lines.findIndex(l => /^TRADING_PAIRS=/.test(l));
const cur = lines[i].slice('TRADING_PAIRS='.length).split(',').map(s => s.trim()).filter(Boolean);
const addCrypto = probe.ok.crypto.filter(p => !cur.includes(p));
lines[i] = 'TRADING_PAIRS=' + [...cur, ...addCrypto].join(',');
fs.writeFileSync(envPath, lines.join('\r\n'));

// 2) instrument_universe.json (OANDA) — append into the right class
const uPath = path.join(root, 'config/instrument_universe.json');
fs.copyFileSync(uPath, `${uPath}.bak-${stamp}`);
const u = JSON.parse(fs.readFileSync(uPath, 'utf8'));
const cls = s => (/^[A-Z]{3}\/[A-Z]{3}$/.test(s) && !/^X(AU|AG|PT|CU)/.test(s) ? 'forex'
  : /^(HK33|JP225|AU200|US30|FR40)/.test(s) ? 'indices' : 'commodities');
const added = { forex: [], commodities: [], indices: [] };
for (const s of probe.ok.oanda) {
  const c = cls(s);
  if (!u.classes[c].symbols.includes(s)) { u.classes[c].symbols.push(s); added[c].push(s); }
}
u.classes.forex.notes = (u.classes.forex.notes || '') + ' 2026-09-29: universe widened for the bot duel ("any market allowed"); every added symbol was price-checked first (runs/2026-09-29_duel/universe_probe.json).';
fs.writeFileSync(uPath, JSON.stringify(u, null, 2));

console.log(`crypto: +${addCrypto.length} -> ${cur.length + addCrypto.length} pairs`);
console.log(`oanda: +forex ${added.forex.length}, +commodities ${added.commodities.length}, +indices ${added.indices.length}`);
console.log('oanda totals:', Object.fromEntries(['forex', 'commodities', 'indices'].map(c => [c, u.classes[c].symbols.length])));
