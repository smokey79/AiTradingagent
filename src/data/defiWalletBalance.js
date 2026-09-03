/**
 * Read-Only DeFi Wallet Balance Viewer
 * ====================================
 * Displays real on-chain balances for a public wallet address. READ-ONLY:
 * this module never holds, requests, or has access to a private key or seed
 * phrase — it only ever calls public RPC endpoints that anyone can query for
 * any address, the same as looking a wallet up on a block explorer.
 *
 * No transactions can ever be sent through this file. If you ever want real
 * transaction execution, that is a completely separate, much more careful
 * piece of work (see claude/real-trading-readiness-report.md).
 */
const axios = require('axios');
const logger = require('../utils/logger');

// Public, keyless RPC endpoints — no API key required for basic balance calls.
// These are the same public endpoints anyone's browser wallet uses.
const CHAINS = {
  cronos: {
    name: 'Cronos',
    rpcUrl: 'https://evm.cronos.org',
    nativeSymbol: 'CRO',
    decimals: 18,
  },
  ethereum: {
    name: 'Ethereum',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    nativeSymbol: 'ETH',
    decimals: 18,
  },
  arbitrum: {
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    decimals: 18,
  },
  base: {
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    decimals: 18,
  },
  polygon: {
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    nativeSymbol: 'POL',
    decimals: 18,
  },
};

// Simple in-memory cache to avoid hammering public RPCs
const cache = {}; // key: `${chain}:${address}` -> { data, ts }
const CACHE_TTL_MS = 30 * 1000; // 30s

function hexToDecimalString(hexWei, decimals) {
  // Convert a hex wei balance string (e.g. "0x1bc16d674ec80000") to a human
  // decimal string with the given number of decimals, without floating-point
  // precision loss on large numbers.
  const wei = BigInt(hexWei);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Fetch the native token balance (CRO, ETH, etc.) for a public address on
 * one chain via a standard JSON-RPC `eth_getBalance` call. This is a plain
 * read call — no key, no signing, cannot move funds.
 */
async function fetchNativeBalance(address, chainKey = 'cronos') {
  const chain = CHAINS[chainKey];
  if (!chain) throw new Error(`Unsupported chain: ${chainKey}`);

  const cacheKey = `${chainKey}:${address}`;
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].ts < CACHE_TTL_MS) {
    return cache[cacheKey].data;
  }

  try {
    const res = await axios.post(
      chain.rpcUrl,
      {
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      },
      { timeout: 8000 }
    );

    if (res.data?.error) {
      throw new Error(res.data.error.message || 'RPC error');
    }

    const hexBalance = res.data?.result;
    if (!hexBalance) throw new Error('No balance returned from RPC');

    const balance = hexToDecimalString(hexBalance, chain.decimals);

    const result = {
      chain: chain.name,
      chainKey,
      address,
      symbol: chain.nativeSymbol,
      balance: parseFloat(balance),
      balanceFormatted: `${balance} ${chain.nativeSymbol}`,
      readOnly: true,
      fetchedAt: new Date().toISOString(),
    };

    cache[cacheKey] = { data: result, ts: now };
    return result;
  } catch (err) {
    logger.warn(`[defiWalletBalance] Failed to fetch ${chainKey} balance for ${address}: ${err.message}`);
    return {
      chain: chain.name,
      chainKey,
      address,
      symbol: chain.nativeSymbol,
      balance: null,
      balanceFormatted: 'Unavailable',
      readOnly: true,
      error: err.message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Fetch balances for one address across multiple chains in parallel.
 */
async function fetchMultiChainBalances(address, chainKeys = ['cronos', 'ethereum']) {
  const results = await Promise.all(
    chainKeys.map(chainKey => fetchNativeBalance(address, chainKey))
  );
  return results;
}

module.exports = {
  fetchNativeBalance,
  fetchMultiChainBalances,
  CHAINS,
};
