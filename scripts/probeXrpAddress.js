/**
 * probeXrpAddress.js — is XRP_WALLET_ADDRESS a personal wallet or a shared
 * exchange deposit address? A pooled exchange address shows enormous ledger
 * activity and usually publishes a Domain. Getting this wrong would put a
 * balance on the dashboard that is not the user's money.
 */
'use strict';
require('dotenv').config();

const ADDR = (process.env.XRP_WALLET_ADDRESS || '').trim();
const RPC = 'https://xrplcluster.com';

async function call(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  });
  return (await r.json()).result;
}

(async () => {
  console.log(`\nAddress: ${ADDR}\n`);
  const info = await call('account_info', { account: ADDR, ledger_index: 'validated' });
  const d = info.account_data || {};
  const domainHex = d.Domain;
  const domain = domainHex ? Buffer.from(domainHex, 'hex').toString('utf8') : '(none)';

  console.log(`Balance        : ${Number(d.Balance) / 1e6} XRP`);
  console.log(`Sequence       : ${d.Sequence}   <- ~transactions this account has SENT`);
  console.log(`Domain         : ${domain}`);
  console.log(`OwnerCount     : ${d.OwnerCount}`);

  const tx = await call('account_tx', { account: ADDR, ledger_index_min: -1, ledger_index_max: -1, limit: 10 });
  const txs = tx.transactions || [];
  console.log(`Recent tx      : ${txs.length} fetched`);
  const counterparties = new Set();
  for (const t of txs) {
    const o = t.tx || t.tx_json || {};
    if (o.Account && o.Account !== ADDR) counterparties.add(o.Account);
    if (o.Destination && o.Destination !== ADDR) counterparties.add(o.Destination);
    if (o.DestinationTag !== undefined) counterparties.add('HAS_DESTINATION_TAG');
  }
  console.log(`Counterparties : ${[...counterparties].slice(0, 8).join(', ') || '(none)'}`);

  console.log('\nRead:');
  const hot = Number(d.Sequence) > 5000 || domain !== '(none)' || counterparties.has('HAS_DESTINATION_TAG');
  if (hot) {
    console.log('  LIKELY A SHARED / EXCHANGE POOLED ADDRESS.');
    console.log('  The balance shown is the exchange\'s pool, NOT your personal holding.');
    console.log('  Do not display it as portfolio value.');
  } else {
    console.log('  Looks like a low-activity personal account.');
  }
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
