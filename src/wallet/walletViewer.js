/**
 * walletViewer.js — READ-ONLY DeFi / multi-chain wallet link.
 *
 * WHAT THIS DOES
 *   Reads public on-chain balances for the wallet ADDRESSES in .env and
 *   prices them in USD via CoinGecko. Nothing else.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — do not add it later:
 *   - It never reads a private key, seed phrase or keystore.
 *   - It never builds, signs, approves or broadcasts a transaction.
 *   - It has no write path to any chain. A balance viewer cannot lose funds.
 *   If you ever want the bot to move on-chain funds, that is a separate,
 *   separately-reviewed module — not an extension of this file.
 *
 * DATA SOURCES (all free, no API key required):
 *   EVM chains  - public JSON-RPC eth_getBalance
 *   Bitcoin/LTC - Blockstream / Litecoinspace REST
 *   XRP         - Ripple public JSON-RPC account_info
 *   Solana      - Solana mainnet JSON-RPC getBalance
 *   Tron        - TronGrid REST
 *   Prices      - CoinGecko simple/price
 */

'use strict';

require('dotenv').config();

const FETCH_TIMEOUT_MS = parseInt(process.env.WALLET_FETCH_TIMEOUT_MS || '12000', 10);
const CACHE_TTL_MS = parseInt(process.env.WALLET_CACHE_TTL_MS || '60000', 10);

let _cache = { at: 0, data: null };

async function getJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(url, method, params) {
  const out = await getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (out.error) throw new Error(out.error.message || 'rpc error');
  return out.result;
}

/**
 * Wallet registry. Each entry is ONE address the bot may observe.
 * envKey      - the .env variable holding the address
 * coingeckoId - used only to price the native balance
 */
const WALLETS = [
  { id: 'evm',  label: 'EVM (Ethereum)', envKey: 'EVM_WALLET_ADDRESS',
    kind: 'evm', rpc: 'https://ethereum-rpc.publicnode.com',
    symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum',
    explorer: a => `https://etherscan.io/address/${a}` },

  { id: 'defi', label: 'DeFi Wallet (EVM)', envKey: 'DEFI_WALLET_ADDRESS',
    kind: 'evm', rpc: 'https://ethereum-rpc.publicnode.com',
    symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum',
    explorer: a => `https://etherscan.io/address/${a}` },

  { id: 'cro',  label: 'Cronos', envKey: 'CRO_WALLET_ADDRESS',
    kind: 'evm', rpc: 'https://cronos-evm-rpc.publicnode.com',
    symbol: 'CRO', decimals: 18, coingeckoId: 'crypto-com-chain',
    explorer: a => `https://cronoscan.com/address/${a}` },

  { id: 'btc',  label: 'Bitcoin', envKey: 'NEXO_WALLET_ADDRESS',
    kind: 'blockstream', api: 'https://blockstream.info/api',
    symbol: 'BTC', decimals: 8, coingeckoId: 'bitcoin',
    explorer: a => `https://blockstream.info/address/${a}` },

  { id: 'ltc',  label: 'Litecoin', envKey: 'LTC_WALLET_ADDRESS',
    kind: 'blockstream', api: 'https://litecoinspace.org/api',
    symbol: 'LTC', decimals: 8, coingeckoId: 'litecoin',
    explorer: a => `https://litecoinspace.org/address/${a}` },

  { id: 'xrp',  label: 'XRP Ledger', envKey: 'XRP_WALLET_ADDRESS',
    kind: 'xrp', rpc: 'https://xrplcluster.com',
    symbol: 'XRP', decimals: 6, coingeckoId: 'ripple',
    explorer: a => `https://xrpscan.com/account/${a}` },

  { id: 'sol',  label: 'Solana', envKey: 'SOL_WALLET_ADDRESS',
    kind: 'solana', rpc: 'https://api.mainnet-beta.solana.com',
    symbol: 'SOL', decimals: 9, coingeckoId: 'solana',
    explorer: a => `https://solscan.io/account/${a}` },

  { id: 'tron', label: 'Tron', envKey: 'TRON_WALLET_ADDRESS',
    kind: 'tron', api: 'https://api.trongrid.io',
    symbol: 'TRX', decimals: 6, coingeckoId: 'tron',
    explorer: a => `https://tronscan.org/#/address/${a}` },
];

/**
 * An exchange's XRP deposit address is SHARED by every customer: the ledger
 * balance is the exchange's pool, not yours, and your own share is identified
 * only by a destination tag. Counting it as portfolio value would overstate
 * holdings by orders of magnitude. A pooled account has sent millions of
 * transactions; a personal one has sent a handful.
 */
const XRP_POOLED_SEQUENCE_THRESHOLD = 5000;

/** Convert a raw integer-string balance to a float using `decimals`. */
function scale(raw, decimals) {
  const n = typeof raw === 'bigint' ? raw : BigInt(String(raw));
  return Number(n) / Math.pow(10, decimals);
}

/** Fetch ONE wallet's native balance. Returns { balance } or throws. */
async function fetchBalance(w, address) {
  switch (w.kind) {
    case 'evm': {
      const hex = await rpc(w.rpc, 'eth_getBalance', [address, 'latest']);
      return scale(BigInt(hex), w.decimals);
    }
    case 'blockstream': {
      const d = await getJson(`${w.api}/address/${address}`);
      const funded = d.chain_stats.funded_txo_sum + d.mempool_stats.funded_txo_sum;
      const spent = d.chain_stats.spent_txo_sum + d.mempool_stats.spent_txo_sum;
      return scale(BigInt(funded - spent), w.decimals);
    }
    case 'xrp': {
      const out = await getJson(w.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_info',
          params: [{ account: address, ledger_index: 'validated' }],
        }),
      });
      const r = out.result || {};
      // An unfunded XRP account is a normal state, not an error.
      if (r.error === 'actNotFound') return 0;
      if (r.error) throw new Error(r.error_message || r.error);
      const bal = scale(BigInt(r.account_data.Balance), w.decimals);
      const seq = Number(r.account_data.Sequence || 0);
      if (seq > XRP_POOLED_SEQUENCE_THRESHOLD) {
        return {
          balance: bal,
          pooled: true,
          note: `Shared exchange deposit address (${seq.toLocaleString()} sends). `
              + 'This is the exchange pool, not your balance — your share is '
              + 'identified by a destination tag and is not readable on-chain.',
        };
      }
      return bal;
    }
    case 'solana': {
      const res = await rpc(w.rpc, 'getBalance', [address]);
      return scale(BigInt(res.value), w.decimals);
    }
    case 'tron': {
      const d = await getJson(`${w.api}/v1/accounts/${address}`);
      const acct = (d.data && d.data[0]) || null;
      if (!acct) return 0;
      return scale(BigInt(acct.balance || 0), w.decimals);
    }
    default:
      throw new Error(`unknown wallet kind: ${w.kind}`);
  }
}

/** Price the native assets we actually hold. Failure -> prices simply absent. */
async function fetchPrices(ids) {
  if (!ids.length) return {};
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price'
      + `?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
    return await getJson(url);
  } catch (e) {
    return { _error: e.message };
  }
}

/**
 * Read every configured wallet. Never throws: a chain that fails comes back
 * with ok:false and an error string, so one dead RPC cannot blank the page.
 */
async function getWalletSnapshot({ force = false } = {}) {
  if (!force && _cache.data && Date.now() - _cache.at < CACHE_TTL_MS) {
    return { ..._cache.data, cached: true };
  }

  const configured = WALLETS
    .map(w => ({ w, address: (process.env[w.envKey] || '').trim() }))
    .filter(x => x.address.length > 0);

  const results = await Promise.all(configured.map(async ({ w, address }) => {
    const base = {
      id: w.id, label: w.label, symbol: w.symbol, address,
      explorer: w.explorer(address), envKey: w.envKey,
    };
    try {
      const raw = await fetchBalance(w, address);
      const r = (typeof raw === 'object' && raw !== null) ? raw : { balance: raw };
      return {
        ...base, ok: true,
        balance: r.balance,
        pooled: r.pooled === true,
        note: r.note || null,
        coingeckoId: w.coingeckoId,
      };
    } catch (e) {
      return { ...base, ok: false, balance: null, error: e.message, coingeckoId: w.coingeckoId };
    }
  }));

  const idsHeld = [...new Set(
    results.filter(r => r.ok && r.balance > 0).map(r => r.coingeckoId)
  )];
  const prices = await fetchPrices(idsHeld);

  let totalUsd = 0;
  let priced = true;
  for (const r of results) {
    const p = prices[r.coingeckoId] && prices[r.coingeckoId].usd;
    if (r.ok && r.balance > 0) {
      if (typeof p === 'number') {
        r.usd = r.balance * p;
        // A pooled exchange address is shown for reference but NEVER counted:
        // it is not the user's money.
        if (!r.pooled) totalUsd += r.usd;
      } else { r.usd = null; if (!r.pooled) priced = false; }
    } else {
      r.usd = r.ok ? 0 : null;
    }
  }

  const data = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    signingEnabled: false,
    wallets: results,
    totalUsd: priced ? totalUsd : null,
    totalUsdComplete: priced,
    chainsOk: results.filter(r => r.ok).length,
    chainsTotal: results.length,
    priceError: prices._error || null,
  };
  _cache = { at: Date.now(), data };
  return { ...data, cached: false };
}

module.exports = { getWalletSnapshot, WALLETS };
