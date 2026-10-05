/**
 * Continuous Arbitrage Engine — REBUILT 2026-09-29 (Alan: "fix arb agent")
 * =======================================================================
 * What was wrong with the old version (backup: runs/2026-09-29_200gbp/
 * archive/continuousArbEngine.js.bak):
 *  1. It only compared prices BETWEEN chains (BSC vs Ethereum etc.) and booked
 *     them as "Zero-Capital Flash Loan" wins. A flash loan is borrowed and
 *     repaid inside ONE transaction on ONE chain — cross-chain flash loans
 *     cannot be executed, so every recorded "win" was impossible.
 *  2. It matched tokens by ticker text ("XRP USDT" search), so a wrapped or
 *     look-alike XRP on BSC was compared to a different one on Ethereum.
 *  3. It ignored price impact: $7,220 through a ~$50k pool moves the price
 *     ~29%, which wipes out a 1.3% spread many times over.
 *  4. It wrote simulated P&L into data/trade_ledger.json every ~5 min.
 *
 * What it does now:
 *  - Groups DexScreener pools by (chain, token CONTRACT ADDRESS) and only
 *    compares pools on the same chain — the only executable flash-loan shape.
 *  - Sizes each opportunity with src/arbitrage/arbMath.js (swap fees, flash
 *    fee, gas, and constant-product price impact) and uses the optimal size.
 *  - Requires the SAME opportunity on 2 consecutive scans before logging it
 *    (one-scan blips are usually stale pool prices).
 *  - Writes HYPOTHETICAL paper observations to data/arb_paper_log.jsonl.
 *    It never touches trade_ledger.json, the portfolio balance or the vault,
 *    because there is still no real on-chain executor (execute_live is a stub).
 *  - Cross-chain gaps are kept only as an informational snapshot
 *    (data/arb_crosschain_snapshot.json) — they need capital + a bridge.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const { CHAINS } = require('./arbScanner');
const { findSameChainOpps } = require('./arbMath');

const DATA_DIR = path.resolve(__dirname, '../../data');
const PAPER_LOG = path.join(DATA_DIR, 'arb_paper_log.jsonl');
const XCHAIN_SNAPSHOT = path.join(DATA_DIR, 'arb_crosschain_snapshot.json');

const SCAN_INTERVAL_MS  = parseInt(process.env.ARB_SCAN_INTERVAL_MS || '15000', 10);
const MIN_LIQUIDITY_USD = parseFloat(process.env.ARB_MIN_LIQUIDITY || '250000');
const MIN_NET_USD       = parseFloat(process.env.ARB_MIN_NET_USD || '3.00');
const MAX_BORROW_USD    = parseFloat(process.env.ARB_MAX_BORROW_USD || '50000');
const SWAP_FEE          = parseFloat(process.env.ARB_DEX_FEE_PCT || '0.30') / 100;   // per swap
const FLASH_FEE         = parseFloat(process.env.ARB_FLASH_FEE_PCT || '0.05') / 100; // Aave v3 0.05% (Balancer 0% not on every chain)
const PHANTOM_MAX_PCT   = parseFloat(process.env.ARB_PHANTOM_MAX_PCT || '2.0');      // bigger gross gaps = bad data
const PERSIST_SCANS     = parseInt(process.env.ARB_PERSIST_SCANS || '2', 10);
const LOG_COOLDOWN_MS   = parseInt(process.env.ARB_COOLDOWN_MS || '300000', 10);
const PAPER             = process.env.PAPER_TRADING !== 'false';

const WATCH_TOKENS = ['ETH', 'WBTC', 'BTC', 'LINK', 'AAVE', 'CRO', 'SOL', 'ARB', 'AVAX', 'UNI', 'HYPE', 'HBAR', 'XRP'];
const STABLES = new Set(['USDT', 'USDC', 'USDC.E', 'USDT.E', 'DAI', 'USDBC', 'FDUSD']);
const GAS_BY_CHAIN = Object.fromEntries(Object.entries(CHAINS).map(([k, v]) => [k, v.gas]));

// ── State ─────────────────────────────────────────────────────────────────────
let scanInterval = null;
let isRunning = false;
let scanCount = 0;
let lastScanAt = null;
let lastOpps = [];
let paperObservations = 0;
let paperHypotheticalNetUsd = 0;
let recentExecutions = [];                 // last 20 paper observations (kept name for dashboard compatibility)
let prevScanKeys = new Map();              // oppKey -> consecutive scans seen
const lastLoggedAt = new Map();            // oppKey -> ts

// ── Data ──────────────────────────────────────────────────────────────────────
// Returns individual POOLS (not one price per chain) with the token contract address.
async function fetchPools(token) {
  try {
    const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(token)}`, { timeout: 4000 });
    return (data?.pairs || [])
      .filter(p =>
        CHAINS[p.chainId] &&
        String(p.baseToken?.symbol || '').toUpperCase() === token &&
        STABLES.has(String(p.quoteToken?.symbol || '').toUpperCase()) &&
        parseFloat(p.priceUsd) > 0 &&
        (p.liquidity?.usd || 0) >= MIN_LIQUIDITY_USD)
      .map(p => ({
        chain: p.chainId,
        dex: p.dexId + (Array.isArray(p.labels) && p.labels.length ? `-${p.labels[0]}` : ''),
        pairAddress: p.pairAddress,
        tokenAddress: p.baseToken?.address,
        symbol: token,
        priceUsd: parseFloat(p.priceUsd),
        liqUsd: p.liquidity.usd,
      }));
  } catch (_) {
    return [];
  }
}

function appendPaperLog(rec) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(PAPER_LOG, JSON.stringify(rec) + '\n');
  } catch (e) { logger.warn(`[ArbEngine] could not write paper log: ${e.message}`); }
}

// Informational only: biggest same-token gap between chains, for the dashboard.
function crossChainSnapshot(pools) {
  const byToken = {};
  for (const p of pools) {
    const t = (byToken[p.symbol] ||= { min: p, max: p });
    if (p.priceUsd < t.min.priceUsd) t.min = p;
    if (p.priceUsd > t.max.priceUsd) t.max = p;
  }
  return Object.entries(byToken)
    .filter(([, v]) => v.min.chain !== v.max.chain)
    .map(([token, v]) => ({
      token, buyChain: v.min.chain, sellChain: v.max.chain,
      grossPct: +(((v.max.priceUsd - v.min.priceUsd) / v.min.priceUsd) * 100).toFixed(3),
      note: 'NOT flash-loanable: needs own capital + bridge (fees, 2-20 min delay). Informational only.',
    }))
    .sort((a, b) => b.grossPct - a.grossPct);
}

// ── Scan ──────────────────────────────────────────────────────────────────────
async function runScan() {
  scanCount++;
  lastScanAt = new Date().toISOString();
  try {
    const results = await Promise.allSettled(WATCH_TOKENS.map(fetchPools));
    const pools = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (pools.length < 2) { logger.debug(`[ArbEngine] Scan #${scanCount} — not enough pool data`); return; }

    // Cross-chain: informational snapshot only
    try { fs.writeFileSync(XCHAIN_SNAPSHOT, JSON.stringify({ at: lastScanAt, gaps: crossChainSnapshot(pools).slice(0, 10) }, null, 2)); } catch (_) {}

    // Same-chain flash-loan opportunities, fully costed
    const opps = findSameChainOpps(pools, {
      swapFee: SWAP_FEE, flashFee: FLASH_FEE, gasByChain: GAS_BY_CHAIN,
      maxSizeUsd: MAX_BORROW_USD, minNetUsd: MIN_NET_USD,
    }).filter(o => o.grossPct <= PHANTOM_MAX_PCT);   // >2% gross on a deep pool = stale/broken price
    lastOpps = opps;

    // Persistence: must be present on consecutive scans
    const nextKeys = new Map();
    for (const o of opps) {
      const key = `${o.chain}|${o.token}|${o.buyPair}|${o.sellPair}`;
      const seen = (prevScanKeys.get(key) || 0) + 1;
      nextKeys.set(key, seen);
      if (seen < PERSIST_SCANS) continue;
      const last = lastLoggedAt.get(key) || 0;
      if (Date.now() - last < LOG_COOLDOWN_MS) continue;
      lastLoggedAt.set(key, Date.now());

      const rec = {
        timestamp: lastScanAt,
        type: 'SAME_CHAIN_FLASH',
        hypothetical: true,           // no on-chain executor exists; nothing was traded
        token: o.token, chain: o.chain, buyDex: o.buyDex, sellDex: o.sellDex,
        buyPair: o.buyPair, sellPair: o.sellPair,
        buyPrice: o.buyPrice, sellPrice: o.sellPrice,
        buyLiqUsd: Math.round(o.buyLiqUsd), sellLiqUsd: Math.round(o.sellLiqUsd),
        grossPct: +o.grossPct.toFixed(3),
        sizeUsd: +o.sizeUsd.toFixed(2),
        feesUsd: +o.feesUsd.toFixed(2), impactUsd: +o.impactUsd.toFixed(2), gasUsd: +o.gasUsd.toFixed(2),
        estNetUsd: +o.netUsd.toFixed(2), estNetPct: +o.netPct.toFixed(3),
        persistedScans: seen,
        caveat: 'Estimate only. Real fills face MEV competition and block latency; DexScreener prices can lag.',
      };
      appendPaperLog(rec);
      paperObservations++;
      paperHypotheticalNetUsd += rec.estNetUsd;
      recentExecutions.unshift(rec);
      if (recentExecutions.length > 20) recentExecutions.pop();
      logger.info(`[ArbEngine] 📝 PAPER OBSERVATION (not a trade): ${o.token} on ${o.chain} ${o.buyDex}→${o.sellDex} gross ${rec.grossPct}% | size $${rec.sizeUsd} | est net $${rec.estNetUsd} after fees/impact/gas | seen ${seen} scans`);
      if (global.broadcastDashboardEvent) global.broadcastDashboardEvent({ type: 'arb_observation', observation: rec });
    }
    prevScanKeys = nextKeys;

    if (opps.length === 0) logger.debug(`[ArbEngine] Scan #${scanCount} — ${pools.length} pools, 0 same-chain opportunities after costs`);
    if (global.broadcastDashboardEvent) global.broadcastDashboardEvent({ type: 'arb_scan', opportunities: opps.slice(0, 10), scanCount, lastScanAt });
  } catch (err) {
    logger.error(`[ArbEngine] Scan #${scanCount} error: ${err.message}`);
  }
}

// ── Public API (unchanged names so autoTrader.js / dashboard keep working) ────
function startContinuousArb(intervalMs = SCAN_INTERVAL_MS) {
  if (isRunning) return getStatus();
  isRunning = true;
  logger.info(`⚡ [ArbEngine] STARTED — same-chain flash-loan scanner, paper observations only (every ${intervalMs / 1000}s | min pool liq $${MIN_LIQUIDITY_USD} | min est net $${MIN_NET_USD})`);
  runScan();
  scanInterval = setInterval(runScan, intervalMs);
  return getStatus();
}

function stopContinuousArb() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  isRunning = false;
  logger.info('[ArbEngine] STOPPED');
  return getStatus();
}

function getStatus() {
  return {
    isRunning, scanCount, lastScanAt, paper: PAPER, scanIntervalMs: SCAN_INTERVAL_MS,
    mode: 'observation-only (no on-chain executor)',
    totalArbTrades: 0,                                   // nothing is ever traded by this engine
    totalArbProfitUsd: 0,
    paperObservations,
    paperHypotheticalNetUsd: +paperHypotheticalNetUsd.toFixed(2),
    config: { minLiquidityUsd: MIN_LIQUIDITY_USD, minNetUsd: MIN_NET_USD, maxBorrowUsd: MAX_BORROW_USD, swapFeePct: SWAP_FEE * 100, flashFeePct: FLASH_FEE * 100, persistScans: PERSIST_SCANS },
  };
}

function getLatestOpportunities(limit = 20) { return lastOpps.slice(0, limit); }
function getRecentExecutions(limit = 20) { return recentExecutions.slice(0, limit); }

module.exports = { startContinuousArb, stopContinuousArb, getStatus, getLatestOpportunities, getRecentExecutions, _runScanForTest: runScan };
