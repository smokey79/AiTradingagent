/**
 * testWalletViewer.js — validates the READ-ONLY wallet link.
 *
 * Run:  node scripts\testWalletViewer.js
 *
 * Checks, in order:
 *   1. SAFETY: the module source contains no private-key / signing surface.
 *   2. LIVE:   every configured chain returns a real balance or a clear error.
 *   3. SANITY: no negative balances; USD total only claimed when fully priced.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'wallet', 'walletViewer.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ', m); } else { fail++; console.log('  FAIL ', m); } };

(async () => {
  console.log('\n1. Safety scan (no signing surface)\n');
  const src = fs.readFileSync(MODULE_PATH, 'utf8');
  // Comments explain what is banned, so only flag real code usage.
  const code = src.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  const banned = [
    [/PRIVATE_KEY/, 'reads a private key'],
    [/mnemonic|seedPhrase|SEED_PHRASE/i, 'reads a seed phrase'],
    [/\bsignTransaction\b|\bsendTransaction\b|\bsendRawTransaction\b/, 'signs or sends a transaction'],
    [/eth_sendTransaction|eth_sign|personal_sign/, 'uses a signing RPC method'],
    [/new\s+Wallet\s*\(|Keypair\.from/, 'constructs a signer'],
  ];
  for (const [re, desc] of banned) ok(!re.test(code), `module never ${desc}`);

  console.log('\n2. Live read of every configured chain\n');
  const { getWalletSnapshot } = require(MODULE_PATH);
  const snap = await getWalletSnapshot({ force: true });

  ok(snap.readOnly === true && snap.signingEnabled === false, 'snapshot declares itself read-only');
  ok(snap.wallets.length > 0, `found ${snap.wallets.length} configured wallet addresses`);

  for (const w of snap.wallets) {
    const usd = typeof w.usd === 'number' ? ` ($${w.usd.toFixed(2)})` : '';
    console.log(
      `   ${w.ok ? 'OK  ' : 'ERR '} ${w.label.padEnd(18)} ` +
      (w.ok ? `${w.balance} ${w.symbol}${usd}${w.pooled ? '   [POOLED - NOT COUNTED]' : ''}` : w.error)
    );
    if (w.note) console.log(`        ${w.note}`);
  }
  const pooledSum = snap.wallets
    .filter(w => w.pooled && typeof w.usd === 'number')
    .reduce((s, w) => s + w.usd, 0);
  ok(snap.totalUsd === null || snap.totalUsd < pooledSum || pooledSum === 0,
     'pooled exchange balances are excluded from the portfolio total');
  const okCount = snap.wallets.filter(w => w.ok).length;
  ok(okCount > 0, `${okCount}/${snap.wallets.length} chains responded`);

  console.log('\n3. Sanity\n');
  ok(snap.wallets.every(w => !w.ok || w.balance >= 0), 'no negative balances');
  ok(snap.totalUsd === null || snap.totalUsdComplete === true,
     'USD total is only reported when every held asset was priced');
  if (snap.totalUsd !== null) console.log(`   Total: $${snap.totalUsd.toFixed(2)}`);
  else console.log('   Total: withheld (a price or a chain was unavailable)');

  console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
