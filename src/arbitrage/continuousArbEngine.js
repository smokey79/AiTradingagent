/**
 * Continuous Arbitrage Engine
 * ===========================
 * Runs a tight scan loop (every 8s by default) looking for profitable
 * cross-DEX / cross-chain spread opportunities. When an opportunity
 * passes the risk gate it fires immediately at max allowable size.
 *
 * Data sources (in priority order):
 *   1. DexScreener live prices per chain
 *   2. CoinGecko simple price API
 *   3. Seed price fallback (never blocks execution)
 */

'use strict';

const axios  = require('axios');
const logger = require('../utils/logger');
const { detectArbitrageOpportunities, CHAINS } = require('./arbScanner');
const { executeFlashLoanArbitrage, simulateFlashLoan } = require('../flashloan/flashloanExecutor');
const { recordTrade } = require('../risk/tradeLedger');
const { getPortfolioState } = require('../risk/riskGate');

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS   = parseInt(process.env.ARB_SCAN_INTERVAL_MS  || '8000',  10);
const MIN_NET_PCT        = parseFloat(process.env.ARB_MIN_NET_PCT      || '0.30');      // ignore spreads < 0.30%
const MIN_NET_USD        = parseFloat(process.env.ARB_MIN_NET_USD      || '3.00');      // ignore if net < $3
const MIN_LIQUIDITY_USD  = parseFloat(process.env.ARB_MIN_LIQUIDITY    || '50000');     // skip illiquid pairs
const PAPER              = process.env.PAPER_TRADING !== 'false';
const MAX_POSITION_FRAC  = parseFloat(process.env.ARB_MAX_POSITION_FRAC|| '0.40');      // max 40% of balance per arb
const MAX_BORROW_USD     = parseFloat(process.env.ARB_MAX_BORROW_USD   || '50000');     // flash loan cap

// Tokens to monitor across chains
const WATCH_TOKENS = ['ETH', 'WBTC', 'BTC', 'LINK', 'AAVE', 'CRO', 'SOL', 'ARB', 'AVAX', 'UNI', 'MATIC'];

// ── State ─────────────────────────────────────────────────────────────────────
let scanInterval  = null;
let isRunning     = false;
let scanCount     = 0;
let totalArbTrades = 0;
let totalArbProfitUsd = 0;
let lastScanAt    = null;
let lastOpps      = [];
let recentExecutions = []; // ring buffer last 20 executed arbs

// ── Cooldown: prevent re-executing same token+route within cooldown window ────
const ARB_COOLDOWN_MS = parseInt(process.env.ARB_COOLDOWN_MS || '300000', 10); // 5 min default
const MAX_ARB_TRADES_PER_HOUR = parseInt(process.env.MAX_ARB_TRADES_PER_HOUR || '6', 10);
const recentArbKeys = new Map(); // key → timestamp of last execution
let hourlyArbCount = 0;
let hourlyResetAt = Date.now();

function isOnCooldown(token, buyChain, sellChain) {
  const key = `${token}:${buyChain}→${sellChain}`;
  const last = recentArbKeys.get(key);
  if (last && (Date.now() - last) < ARB_COOLDOWN_MS) return true;
  return false;
}

function markExecuted(token, buyChain, sellChain) {
  const key = `${token}:${buyChain}→${sellChain}`;
  recentArbKeys.set(key, Date.now());
  // Prune old keys
  for (const [k, ts] of recentArbKeys) {
    if (Date.now() - ts > ARB_COOLDOWN_MS * 2) recentArbKeys.delete(k);
  }
}

function checkHourlyLimit() {
  if (Date.now() - hourlyResetAt > 3600000) {
    hourlyArbCount = 0;
    hourlyResetAt = Date.now();
  }
  return hourlyArbCount < MAX_ARB_TRADES_PER_HOUR;
}

// ── Live price fetching ───────────────────────────────────────────────────────

// DexScreener: pull top pairs for a token across all supported chains
async function fetchDexScreenerPrices(token) {
  try {
    const { data } = await axios.get(
      `https://api.dexscreener.com/latest/dex/search?q=${token}%20USDT`,
      { timeout: 1500 }
    );
    const pairs = (data?.pairs || []).filter(p =>
      p.priceUsd && parseFloat(p.priceUsd) > 0 &&
      (p.liquidity?.usd || 0) >= MIN_LIQUIDITY_USD &&
      CHAINS[p.chainId]   // only chains we support
    );

    // Build chain → price map
    const byChain = {};
    for (const p of pairs) {
      const chain = p.chainId;
      if (byChain[chain]) continue; // take first (highest liquidity) per chain
      byChain[chain] = {
        price:       parseFloat(p.priceUsd),
        liq:         p.liquidity?.usd || 0,
        vol:         p.volume?.h24    || 0,
        dex:         p.dexId,
        ch24h:       p.priceChange?.h24 || 0,
      };
    }
    return byChain;
  } catch (_) {
    return null;
  }
}

// CoinGecko fallback for tokens not on DexScreener well
async function fetchCoinGeckoPrices(tokens) {
  const ids = tokens.map(t => t.toLowerCase().replace('wbtc', 'bitcoin').replace('btc', 'bitcoin')).join(',');
  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 5000 }
    );
    return data;
  } catch (_) {
    return {};
  }
}

// Build a live price map for all watched tokens across all chains
async function buildLivePriceMap() {
  const priceMap = {};

  await Promise.allSettled(
    WATCH_TOKENS.map(async (token) => {
      const dexPrices = await fetchDexScreenerPrices(token);
      if (dexPrices && Object.keys(dexPrices).length >= 2) {
        priceMap[token] = dexPrices;
      }
    })
  );

  return priceMap;
}

// ── Risk gate for arb ─────────────────────────────────────────────────────────

function arbRiskGate(opp, portfolioBalance) {
  // Discard phantom token mismatches (spread > 20% is impossible on liquid majors)
  if (opp.netPct > 20.0 || (opp.grossPct && opp.grossPct > 20.0)) {
    return { approved: false, reason: `spread ${opp.netPct}% > 20% (phantom contract mismatch guard)` };
  }

  // Must clear minimum profit thresholds
  if (opp.netPct < MIN_NET_PCT) return { approved: false, reason: `netPct ${opp.netPct}% < ${MIN_NET_PCT}%` };

  // Liquidity check
  if (opp.minLiquidity && opp.minLiquidity < MIN_LIQUIDITY_USD) {
    return { approved: false, reason: `liquidity $${opp.minLiquidity} too thin` };
  }

  // Zero-capital flash loan borrow sizing:
  // Borrow from protocol liquidity vaults ($10,000 USD default up to MAX_BORROW_USD)
  const poolMax = opp.minLiquidity ? Math.min(opp.minLiquidity * 0.10, MAX_BORROW_USD) : 10000;
  const borrowAmountUsd = Math.max(5000, Math.min(10000, poolMax));

  // Net USD check after sizing
  const netUsd = (opp.netPct / 100) * borrowAmountUsd;
  if (netUsd < MIN_NET_USD) return { approved: false, reason: `netUsd $${netUsd.toFixed(2)} < $${MIN_NET_USD}` };

  return { approved: true, borrowAmountUsd, estimatedNetUsd: parseFloat(netUsd.toFixed(2)) };
}

// ── Execute one arb opportunity ───────────────────────────────────────────────

async function executeArb(opp, borrowAmountUsd) {
  const { allocateProfit } = require('../utils/profitAllocator');
  const sim = simulateFlashLoan({
    token:          opp.token,
    borrowAmountUsd,
    provider:       'balancer', // 0% fee — always prefer Balancer
    buyChain:       opp.buyChain,
    sellChain:      opp.sellChain,
    buyPrice:       opp.buyPrice,
    sellPrice:      opp.sellPrice,
    gasCostUsd:     opp.gasCostUsd || 2.5,
  });

  if (!sim.isProfitable) {
    logger.warn(`[ArbEngine] Simulation shows unprofitable after slippage: ${sim.recommendation}`);
    return null;
  }

  const result = await executeFlashLoanArbitrage({
    ...opp,
    borrowAmountUsd,
    provider: 'balancer',
  }, PAPER);

  if (result.success) {
    const pnl = sim.netProfitUsd;
    totalArbTrades++;
    totalArbProfitUsd += pnl;
    hourlyArbCount++;
    markExecuted(opp.token, opp.buyChain, opp.sellChain);

    const tradeRecord = {
      pair:          `${opp.token}/USDT`,
      symbol:        opp.token,
      side:          'FLASHLOAN',
      price:         opp.buyPrice,
      amount:        parseFloat((borrowAmountUsd / opp.buyPrice).toFixed(6)),
      positionSizeUsd: borrowAmountUsd,
      leverage:      1,
      pnlUsd:        parseFloat(pnl.toFixed(2)),
      pnlPct:        parseFloat(sim.netProfitPct.toFixed(2)),
      outcome:       pnl > 0 ? 'WIN' : 'LOSS',
      confidence:    Math.min(0.95, opp.netPct / 5),
      reason:        `Zero-Capital Flash Loan: ${opp.buyChain} [${opp.buyDex}] → ${opp.sellChain} [${opp.sellDex}] (+${opp.netPct}% net spread)`,
      paper:         PAPER,
      arbRoute:      `${opp.buyChain.toUpperCase()} [${opp.buyDex}] → ${opp.sellChain.toUpperCase()} [${opp.sellDex}]`,
      flashLoan:     true,
    };

    recordTrade(tradeRecord);
    try {
      allocateProfit(pnl, 'Flash Loan Arbitrage');
    } catch (_) {}

    const execution = { ...tradeRecord, timestamp: new Date().toISOString(), txId: result.txId };
    recentExecutions.unshift(execution);
    if (recentExecutions.length > 20) recentExecutions.pop();

    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({ type: 'arb_executed', trade: execution, totalArbProfitUsd });
    }

    logger.info(`⚡ [ArbEngine] ARB EXECUTED [${PAPER ? 'PAPER' : 'LIVE'}] ${opp.token} ${opp.buyChain}→${opp.sellChain} | Net: +$${pnl.toFixed(2)} | Total arb profit: $${totalArbProfitUsd.toFixed(2)}`);
    return execution;
  }
  return null;
}

// ── Main scan loop ─────────────────────────────────────────────────────────────

async function runScan() {
  scanCount++;
  lastScanAt = new Date().toISOString();
  const t0 = Date.now();

  try {
    // Hourly trade limit check
    if (!checkHourlyLimit()) {
      logger.debug(`[ArbEngine] Scan #${scanCount} — hourly arb limit reached (${hourlyArbCount}/${MAX_ARB_TRADES_PER_HOUR})`);
      return;
    }

    // 1. Fetch LIVE prices — require real DexScreener data, never trade on seed prices alone
    const livePrices = await buildLivePriceMap();
    if (Object.keys(livePrices).length < 2) {
      logger.debug(`[ArbEngine] Scan #${scanCount} — insufficient live price data (${Object.keys(livePrices).length} tokens), skipping`);
      return;
    }

    // 2. Detect opportunities using LIVE prices only
    const opps = detectArbitrageOpportunities(livePrices);
    lastOpps = opps;

    const actionable = opps.filter(o => o.netPct >= MIN_NET_PCT && o.minLiquidity >= MIN_LIQUIDITY_USD);

    if (actionable.length === 0) {
      logger.debug(`[ArbEngine] Scan #${scanCount} — no actionable opportunities (${opps.length} raw, ${Date.now()-t0}ms)`);
      return;
    }

    logger.info(`[ArbEngine] Scan #${scanCount} — ${actionable.length} actionable opps | top: ${actionable[0].token} ${actionable[0].buyChain}→${actionable[0].sellChain} net=${actionable[0].netPct}%`);

    // 3. Execute BEST opportunity only (1 per scan), with cooldown check
    const portfolio = getPortfolioState();
    const balance   = portfolio.currentBalance || 250;

    for (const opp of actionable) {
      // Skip if this route was recently executed
      if (isOnCooldown(opp.token, opp.buyChain, opp.sellChain)) {
        logger.debug(`[ArbEngine] ${opp.token} ${opp.buyChain}→${opp.sellChain} on cooldown, skipping`);
        continue;
      }
      const gate = arbRiskGate(opp, balance);
      if (!gate.approved) {
        logger.debug(`[ArbEngine] ${opp.token} ${opp.buyChain}→${opp.sellChain} gated: ${gate.reason}`);
        continue;
      }
      await executeArb(opp, gate.borrowAmountUsd);
      break; // Only 1 arb execution per scan cycle
    }

    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({ type: 'arb_scan', opportunities: actionable.slice(0, 10), scanCount, lastScanAt });
    }
  } catch (err) {
    logger.error(`[ArbEngine] Scan #${scanCount} error: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

function startContinuousArb(intervalMs = SCAN_INTERVAL_MS) {
  if (isRunning) return getStatus();
  isRunning = true;
  logger.info(`⚡ [ArbEngine] Continuous arbitrage engine STARTED (scan every ${intervalMs/1000}s | minSpread=${MIN_NET_PCT}% | paper=${PAPER})`);
  runScan(); // immediate first scan
  scanInterval = setInterval(runScan, intervalMs);
  return getStatus();
}

function stopContinuousArb() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  isRunning = false;
  logger.info('[ArbEngine] Continuous arb engine STOPPED');
  return getStatus();
}

function getStatus() {
  return {
    isRunning, scanCount, totalArbTrades, totalArbProfitUsd: parseFloat(totalArbProfitUsd.toFixed(4)),
    lastScanAt, paper: PAPER, scanIntervalMs: SCAN_INTERVAL_MS,
    config: { minNetPct: MIN_NET_PCT, minNetUsd: MIN_NET_USD, minLiquidityUsd: MIN_LIQUIDITY_USD, maxPositionFrac: MAX_POSITION_FRAC },
  };
}

function getLatestOpportunities(limit = 20) {
  return lastOpps.slice(0, limit);
}

function getRecentExecutions(limit = 20) {
  return recentExecutions.slice(0, limit);
}

module.exports = { startContinuousArb, stopContinuousArb, getStatus, getLatestOpportunities, getRecentExecutions };
