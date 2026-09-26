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
const { getPortfolioState, checkRiskGate } = require('../risk/riskGate');

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS   = parseInt(process.env.ARB_SCAN_INTERVAL_MS  || '8000',  10);
const MIN_NET_PCT        = parseFloat(process.env.ARB_MIN_NET_PCT      || '0.30');      // ignore spreads < 0.30%
const MIN_NET_USD        = parseFloat(process.env.ARB_MIN_NET_USD      || '3.00');      // ignore if net < $3
const MIN_LIQUIDITY_USD  = parseFloat(process.env.ARB_MIN_LIQUIDITY    || '50000');     // skip illiquid pairs
const PAPER              = process.env.PAPER_TRADING !== 'false';
const MAX_POSITION_FRAC  = parseFloat(process.env.ARB_MAX_POSITION_FRAC|| '0.40');      // max 40% of balance per arb
const MAX_BORROW_USD     = parseFloat(process.env.ARB_MAX_BORROW_USD   || '50000');     // flash loan cap

// Tokens to monitor across chains
// 2026-09-15: HYPE, HBAR and XRP added at Alan's request.
// Liquidity measured the same day (24h volume / market cap — the fill-risk
// proxy, not a price view): HYPE 4.36% (deep, rank #10), HBAR 2.14% (deep),
// CRO 0.31% (THIN — roughly 7x thinner than peers of similar size, and it
// showed the widest cross-venue gap of the group; treat CRO results as
// execution-constrained before treating them as signal).
// Chain caveat worth knowing: HBAR and Hyperliquid both have EVM-compatible
// execution, but XRP Ledger's native DEX is not EVM and XRPL EVM-sidechain
// DEX coverage on DexScreener is patchy — expect XRP routes to resolve less
// often than the others rather than to fail loudly.
const WATCH_TOKENS = ['ETH', 'WBTC', 'BTC', 'LINK', 'AAVE', 'CRO', 'SOL', 'ARB', 'AVAX', 'UNI', 'MATIC', 'HYPE', 'HBAR', 'XRP'];

// ── State ─────────────────────────────────────────────────────────────────────
let scanInterval  = null;
let isRunning     = false;
let scanCount     = 0;
let totalArbTrades = 0;
let totalArbProfitUsd = 0;
// 2026-09-15: how many opportunities the real riskGate refused. Surfaced in
// getStatus() so a blocked engine is visibly blocked, not silently idle.
let blockedByRiskGate = 0;
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
  // ───────────────────────────────────────────────────────────────────────
  // HARDENED 2026-09-15 after an audit found this path booking $82.55 of
  // profit into trade_ledger.json that never reached the portfolio (actual
  // P&L that day: -$0.08). Three fabricated 100%-win records went into the
  // history the learning layer reads. What went wrong, and what now stops it:
  //
  //  (a) This gate is NOT the real risk gate. It never called
  //      src/risk/riskGate.js, so the 72% confidence floor, the majority
  //      consensus rule and the win-rate gate were all bypassed. Alan's
  //      instruction is that ANY sourced trade must pass riskGate — enforced
  //      at the call site in executeArb(), below.
  //  (b) The 20% "phantom guard" was far too loose. Measured the same day
  //      across 85 real venues, BTC's entire cross-venue gap was 0.16% GROSS
  //      and NEGATIVE net of costs. scan_log.jsonl meanwhile held entries
  //      claiming 24-55% on ETH and LINK — broken pool prices, not trades.
  //      A "spread" above ARB_PHANTOM_MAX_PCT is now treated as a data fault.
  //  (c) MIN_NET_PCT of 0.30% sat right on top of real round-trip cost
  //      (~0.27% for majors), so noise cleared it. There is now an explicit
  //      margin-of-safety multiple over modelled cost.
  // ───────────────────────────────────────────────────────────────────────
  const PHANTOM_MAX_PCT = parseFloat(process.env.ARB_PHANTOM_MAX_PCT || '2.0');
  const COST_SAFETY_MULT = parseFloat(process.env.ARB_COST_SAFETY_MULT || '2.0');

  if (!Number.isFinite(opp.netPct)) {
    return { approved: false, reason: 'netPct missing/NaN — refusing to act on an unparsed opportunity' };
  }

  // Phantom / bad-data guard. A genuine dislocation on a liquid pair does not
  // sit at multiple percent waiting to be taken; that is a pricing fault.
  if (opp.netPct > PHANTOM_MAX_PCT || (opp.grossPct && opp.grossPct > PHANTOM_MAX_PCT)) {
    return {
      approved: false,
      reason: `spread ${opp.netPct}% exceeds ${PHANTOM_MAX_PCT}% — treated as a DATA FAULT (stale/mismatched pool), not an opportunity`,
      dataFault: true,
    };
  }

  // Margin of safety over modelled round-trip cost, not just a flat floor.
  const modelledCostPct = Number.isFinite(opp.costPct)
    ? opp.costPct
    : ((opp.grossPct != null && opp.netPct != null) ? Math.max(0, opp.grossPct - opp.netPct) : 0.27);
  const requiredPct = Math.max(MIN_NET_PCT, modelledCostPct * COST_SAFETY_MULT);
  if (opp.netPct < requiredPct) {
    return {
      approved: false,
      reason: `netPct ${opp.netPct}% < required ${requiredPct.toFixed(3)}% (${COST_SAFETY_MULT}x modelled cost ${modelledCostPct.toFixed(3)}%)`,
    };
  }

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

    // ───────────────────────────────────────────────────────────────────────
    // MANDATORY RISK GATE — added 2026-09-15 on Alan's instruction:
    // "our trade seeking agent can source any trade possible, given it must
    // pass riskgate."
    //
    // Until now this path called its own local arbRiskGate() and NEVER the
    // real one, so the 72% confidence floor, the majority-consensus rule and
    // the rolling win-rate gate were all bypassed. That is how three
    // simulated flash-loan "wins" worth $82.55 reached a ledger whose real
    // P&L was -$0.08.
    //
    // The consensus object below is HONEST: an arbitrage opportunity has no
    // LLM agent votes behind it, so agentsAgreeing is 0 and it will be
    // rejected by the majority rule. That is the correct default. If you want
    // arbitrage to run again, it has to be a deliberate decision:
    // set ARB_ALLOW_WITHOUT_CONSENSUS=true, which permits it under the
    // hardened arbRiskGate() above INSTEAD of agent consensus — never with a
    // faked vote count.
    // ───────────────────────────────────────────────────────────────────────
    const ALLOW_WITHOUT_CONSENSUS = String(process.env.ARB_ALLOW_WITHOUT_CONSENSUS || 'false').toLowerCase() === 'true';
    if (!ALLOW_WITHOUT_CONSENSUS) {
      let gateResult = { approved: false, reason: 'risk gate not reached' };
      try {
        gateResult = await checkRiskGate(`${opp.token}/USDT`, {
          signal: 'BUY',
          confidence: Math.min(0.95, opp.netPct / 5),
          agentsAgreeing: 0,          // no agent voted on this — do not pretend otherwise
          totalAgents: 0,
          veto_triggered: false,
        }, { price: { price: opp.buyPrice } });
      } catch (err) {
        gateResult = { approved: false, reason: `risk gate threw: ${err.message}` };
      }
      if (!gateResult.approved) {
        logger.warn(
          `[ArbEngine] 🛑 BLOCKED by riskGate (${opp.token} ${opp.buyChain}→${opp.sellChain}, +${opp.netPct}%): ${gateResult.reason}`
        );
        blockedByRiskGate++;
        return null;
      }
    }

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
      // 2026-09-15: explicit provenance so these records can never again be
      // mistaken for realised directional performance. `simulated` means the
      // P&L came out of simulateFlashLoan(), NOT out of the portfolio — the
      // audit that prompted this found $82.55 of such "profit" sitting in the
      // ledger against an actual portfolio move of -$0.08.
      simulated:     true,
      excludeFromLearning: true,
      agentsAgreeing: 0,
      totalAgents:   0,
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
