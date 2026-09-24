/**
 * Institutional Risk Gate & Kelly Sizing Engine
 * Hard-veto safety checks, rolling win rate gate, and dynamic capital allocation.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getPerformanceStats } = require('./tradeLedger');
const { classifyRegime, REGIMES } = require('./regimeClassifier');

const DATA_DIR = path.resolve(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'portfolio_state.json');
const ALLOCATION_FILE = path.join(DATA_DIR, 'allocation_settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Multi-Currency Exchange Rates vs USD
const CURRENCY_RATES = {
  USD: 1.0,
  USDT: 1.0,
  USDP: 1.0,
  GBPX: 1.30, // 1 GBPX = 1.30 USD
};

// Configurable Risk & Allocation Constraints
const INITIAL_DEPOSIT = parseFloat(process.env.INITIAL_DEPOSIT || '250');
// 2026-09-15: lowered 0.72 -> 0.68 at Alan's instruction. Still an ABSOLUTE
// FLOOR (see the clamp further down) — regime logic may raise the bar above
// this but can no longer drop below it, which is the behaviour that was
// silently allowing 0.65 entries before today.
// Not to be confused with MIN_WIN_RATE_GATE, which is also 0.68 but measures
// something different: that is the rolling win rate of closed trades, this is
// how strongly the agents agree on the trade in front of them.
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.68');
const LEVERAGE_MAX = parseFloat(process.env.LEVERAGE_MAX || '20.0');
const MAX_SINGLE_POSITION_PCT = parseFloat(process.env.RISK_MAX_SINGLE_POSITION_PCT || '10'); // Max 10% on one trade ($25 on $250)
const MAX_PORTFOLIO_EXPOSURE_PCT = parseFloat(process.env.RISK_MAX_PORTFOLIO_EXPOSURE_PCT || '95'); // Max 95% total exposure
const MAX_SESSION_LOSS_PCT = parseFloat(process.env.RISK_MAX_SESSION_LOSS_PCT || '8'); // Max 8% session drawdown
const MIN_WIN_RATE_GATE = parseFloat(process.env.RISK_MIN_WIN_RATE_GATE || '0.68');
const RISK_GATE_N = parseInt(process.env.RISK_GATE_MIN_TRADES || '250', 10); // 68% over 250 real trades (Alan, 2026-09-24) // 68% rolling win rate target
const MIN_MARGIN_BALANCE_USD = parseFloat(process.env.MIN_MARGIN_BALANCE_USD || '30.0'); // $30 margin floor
// 2026-09-15 (Alan's instruction): "no trade should be allowed that does not
// have majority consensus". The old rule was a FIXED floor of 2 agents — with
// an 11-agent roster that is 18%, not a majority, and it is why trades were
// clearing the gate on 1-2 votes. MIN_AGENTS is now an absolute FLOOR only;
// the real requirement is a strict majority of the agents that actually voted.
const MIN_AGENTS = parseInt(process.env.MIN_AGENTS || '2', 10);

/**
 * Strict majority of the agents that actually reported this cycle.
 * 11 agents -> needs 6.  5 agents -> needs 3.  2 agents -> needs 2.
 * Falls back to MIN_AGENTS when totalAgents is missing/unusable, and never
 * returns less than MIN_AGENTS, so this can only ever tighten the old rule.
 */
function requiredAgreement(totalAgents) {
  const n = Number(totalAgents);
  if (!Number.isFinite(n) || n <= 0) return MIN_AGENTS;
  return Math.max(MIN_AGENTS, Math.floor(n / 2) + 1);
}
const MAX_PORTFOLIO_RISK_SETTING = process.env.MAX_PORTFOLIO_RISK || 'dynamic';

/**
 * Dynamic Portfolio Risk Formulation
 * Dynamically scales capital at risk per trade (0.8% to 4.5%) based on:
 * 1. AI Consensus Conviction: scales from 0.80x (at 70% confidence) up to 1.80x (at 95% confidence)
 * 2. Rolling Performance & Win Rate: scales up to 1.20x if win rate >= 75%, cuts to 0.70x in drawdown
 * 3. Market Regime & BTC Direction: boosts risk in strong expansion (+15%), protects capital in macro drag (-25%)
 * 4. Stop Loss & ATR Normalization: ensures Position Size * Stop Loss % <= Balance * Dynamic Risk Pct
 */
function calculateDynamicPortfolioRisk({
  confidence = 0.75,
  winRate = 0.70,
  btcTrend = 'NEUTRAL',
  rawSetting = MAX_PORTFOLIO_RISK_SETTING,
} = {}) {
  const isDynamic = String(rawSetting).toLowerCase().includes('dynamic');
  const baseRisk = !isDynamic && !isNaN(parseFloat(rawSetting))
    ? Math.max(0.005, Math.min(0.05, parseFloat(rawSetting)))
    : 0.02; // Default 2.0% baseline

  if (!isDynamic && process.env.FORCE_FIXED_RISK === 'true') {
    return {
      dynamicRiskPct: parseFloat((baseRisk * 100).toFixed(2)),
      dynamicRiskDecimal: parseFloat(baseRisk.toFixed(4)),
      isDynamic: false,
      factors: { baseRisk },
    };
  }

  // 1. Confidence scalar (0.80x at 70% -> 1.0x at 76% -> 1.45x at 88% -> 1.75x at 95%)
  const confClamped = Math.max(0.60, Math.min(0.98, confidence));
  const confMultiplier = Math.max(0.75, Math.min(1.80, 0.75 + (confClamped - 0.70) * 4.0));

  // 2. Win rate & performance momentum scalar
  const winRateMultiplier = winRate >= 0.75 ? 1.20 : winRate < 0.65 ? 0.70 : 1.00;

  // 3. BTC regime scalar
  let regimeMultiplier = 1.0;
  const trendStr = String(btcTrend).toUpperCase();
  if (trendStr.includes('STRONG_BULLISH') || trendStr.includes('EXPANSION')) {
    regimeMultiplier = 1.15;
  } else if (trendStr.includes('BEARISH') || trendStr.includes('CONTRACTION')) {
    regimeMultiplier = 0.75;
  }

  const calculatedRisk = baseRisk * confMultiplier * winRateMultiplier * regimeMultiplier;
  // Institutional bounds: 0.8% floor to 4.5% ceiling
  const boundedRisk = Math.max(0.008, Math.min(0.045, calculatedRisk));

  return {
    dynamicRiskPct: parseFloat((boundedRisk * 100).toFixed(2)),
    dynamicRiskDecimal: parseFloat(boundedRisk.toFixed(4)),
    isDynamic: true,
    factors: {
      baseRisk: parseFloat(baseRisk.toFixed(4)),
      confMultiplier: parseFloat(confMultiplier.toFixed(2)),
      winRateMultiplier,
      regimeMultiplier,
    },
  };
}

// Allocation Override State
let allocationSettings = {
  baseCurrency: process.env.BASE_ACCOUNT_CURRENCY || 'USDT', // GBPX, USDP, USDT, USD
  defaultAllocationPct: parseFloat(process.env.ALLOCATION_DEFAULT_PCT || '10.0'),
  overrideAllocationPct: process.env.ALLOCATION_OVERRIDE_PCT ? parseFloat(process.env.ALLOCATION_OVERRIDE_PCT) : null,
  memeAllocationPct: parseFloat(process.env.ALLOCATION_MEME_PCT || '3.0'),
  maxExposurePct: MAX_PORTFOLIO_EXPOSURE_PCT,
  updatedAt: new Date().toISOString(),
};

function loadPersistedAllocationSettings() {
  try {
    ensureDataDir();
    if (fs.existsSync(ALLOCATION_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALLOCATION_FILE, 'utf8'));
      allocationSettings = { ...allocationSettings, ...data };
    }
  } catch (e) {
    logger.warn(`Could not load allocation settings: ${e.message}`);
  }
}

function savePersistedAllocationSettings() {
  try {
    ensureDataDir();
    allocationSettings.updatedAt = new Date().toISOString();
    fs.writeFileSync(ALLOCATION_FILE, JSON.stringify(allocationSettings, null, 2));
  } catch (e) {
    logger.warn(`Could not save allocation settings: ${e.message}`);
  }
}

loadPersistedAllocationSettings();

function getAllocationSettings() {
  return { ...allocationSettings };
}

function updateAllocationSettings(newSettings = {}) {
  if (typeof newSettings.baseCurrency === 'string') {
    const curr = newSettings.baseCurrency.toUpperCase();
    if (CURRENCY_RATES[curr]) allocationSettings.baseCurrency = curr;
  }
  if (typeof newSettings.defaultAllocationPct === 'number') {
    allocationSettings.defaultAllocationPct = Math.max(1, Math.min(30, newSettings.defaultAllocationPct));
  }
  if (newSettings.overrideAllocationPct !== undefined) {
    allocationSettings.overrideAllocationPct = newSettings.overrideAllocationPct === null ? null : Math.max(1, Math.min(50, Number(newSettings.overrideAllocationPct)));
  }
  if (typeof newSettings.memeAllocationPct === 'number') {
    allocationSettings.memeAllocationPct = Math.max(0.5, Math.min(10, newSettings.memeAllocationPct));
  }
  if (typeof newSettings.maxExposurePct === 'number') {
    allocationSettings.maxExposurePct = Math.max(10, Math.min(80, newSettings.maxExposurePct));
  }
  savePersistedAllocationSettings();
  logger.info(`Updated Allocation Settings: ${JSON.stringify(allocationSettings)}`);
  return getAllocationSettings();
}

/**
 * Calculate Proportionate Allocation in selected base currency (GBPX / USDP / USDT / USD)
 */
function calculateProportionateAllocation({
  balance = currentBalance,
  baseCurrency = allocationSettings.baseCurrency,
  riskScore = 2.5,
  overridePct = allocationSettings.overrideAllocationPct,
  isMemeCoin = false,
  confidence = 0.85,
}) {
  const currency = baseCurrency.toUpperCase();
  const rateUsd = CURRENCY_RATES[currency] || 1.0; // Rate to USD
  const balanceInSelectedCurrency = balance / rateUsd;

  let allocPct = overridePct !== null && overridePct !== undefined
    ? overridePct
    : isMemeCoin
      ? allocationSettings.memeAllocationPct
      : allocationSettings.defaultAllocationPct;

  // Scale slightly by AI confidence (e.g. 85% confidence -> 1.06x, 72% confidence -> 0.9x)
  const confidenceMultiplier = Math.max(0.8, Math.min(1.2, confidence / 0.8));
  const effectivePct = parseFloat((allocPct * confidenceMultiplier).toFixed(2));

  const positionInCurrency = (balanceInSelectedCurrency * effectivePct) / 100;
  const positionUsd = positionInCurrency * rateUsd;

  // Bound between minimum $10 and max exposure
  const boundedUsd = Math.max(10, Math.min(positionUsd, (balance * allocationSettings.maxExposurePct) / 100));
  const boundedInCurrency = boundedUsd / rateUsd;

  return {
    baseCurrency: currency,
    rateToUsd: rateUsd,
    totalBalanceInCurrency: parseFloat(balanceInSelectedCurrency.toFixed(2)),
    totalBalanceUsd: parseFloat(balance.toFixed(2)),
    targetAllocationPct: allocPct,
    effectiveAllocationPct: effectivePct,
    isOverrideActive: overridePct !== null && overridePct !== undefined,
    isMemeCoin,
    positionSizeInCurrency: parseFloat(boundedInCurrency.toFixed(2)),
    positionSizeUsd: parseFloat(boundedUsd.toFixed(2)),
  };
}

// State management (loaded from disk if present)
let currentBalance = INITIAL_DEPOSIT;
let totalPnL = 0;
let sessionPeakBalance = INITIAL_DEPOSIT;
const openPositions = new Map(); // pair -> { sizeUsd, entryPrice, side, timestamp }
// ─── Position lifetime ───────────────────────────────────────────────────────
// This was hard-coded at 5 minutes. Measured on 2026-09-15 (scripts/analyseTimeouts.js):
// 7 of 7 resolved trades closed on the timer, ZERO on take-profit or stop-loss,
// because the average price move inside a 5-minute window on the traded pairs was
// 0.224% while the gate sets a 1.5%-4% stop and a 3%-8% target. The exits were
// unreachable by construction, so the bot was sampling noise rather than testing
// a strategy. Under square-root-of-time scaling a 1.5% stop needs roughly 4 hours
// to become reachable — hence the 240-minute default.
// Change it in .env with POSITION_TTL_MINUTES.
const POSITION_TTL_MINUTES = Math.max(1, parseInt(process.env.POSITION_TTL_MINUTES || '240', 10));
const POSITION_TTL_MS = POSITION_TTL_MINUTES * 60 * 1000;

// Below this the ATR-based exits are very unlikely to be reachable, so the timer
// becomes the de-facto strategy again. Warn rather than silently override —
// a short TTL is a legitimate choice for a deliberate scalping test.
if (POSITION_TTL_MINUTES < 60) {
  try {
    require('../utils/logger').warn(
      `[riskGate] POSITION_TTL_MINUTES=${POSITION_TTL_MINUTES}. The stop-loss band is `
      + '1.5%-4%; at this holding time most positions will close on the timer rather '
      + 'than on TP/SL, which produces noise rather than strategy outcomes.');
  } catch (_) {
    console.warn(`[riskGate] POSITION_TTL_MINUTES=${POSITION_TTL_MINUTES} — TP/SL likely unreachable.`);
  }
}

// Round-trip execution cost (entry + exit fees and spread) as a % of notional.
// Without this, recorded P&L is the raw price move and every result looks better
// than it was. Tokenised equities and thin alt pairs are wider than this default;
// tune per venue with ROUND_TRIP_COST_PCT.
const ROUND_TRIP_COST_PCT = Math.max(0, parseFloat(process.env.ROUND_TRIP_COST_PCT || '0.20'));

// A position this old was never resolved by a price check (feed outage, pair
// removed from the rotation). Dropping it silently loses a trade record, so it is
// kept far longer than the TTL and logged when it goes.
const POSITION_ABANDON_MS = POSITION_TTL_MS * 4;

function pruneStalePositions() {
  const now = Date.now();
  for (const [pair, p] of openPositions.entries()) {
    const age = p.timestamp ? (now - new Date(p.timestamp).getTime()) : POSITION_ABANDON_MS + 1;
    if (age > POSITION_ABANDON_MS) {
      try {
        require('../utils/logger').warn(
          `[riskGate] Abandoning ${pair}: open ${(age / 60000).toFixed(0)}min with no price `
          + 'resolution. No trade record written — check the price feed for this pair.');
      } catch (_) {}
      openPositions.delete(pair);
    }
  }
}

function loadPersistedState() {
  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (typeof data.currentBalance === 'number') currentBalance = data.currentBalance;
      if (typeof data.totalPnL === 'number') totalPnL = data.totalPnL;
      if (typeof data.sessionPeakBalance === 'number') sessionPeakBalance = data.sessionPeakBalance;
    }
  } catch (e) {
    logger.warn(`Could not load persisted portfolio state: ${e.message}`);
  }
}

function savePersistedState() {
  try {
    ensureDataDir();
    const data = {
      currentBalance,
      totalPnL,
      sessionPeakBalance,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn(`Could not save portfolio state: ${e.message}`);
  }
}

loadPersistedState();

function getPortfolioState() {
  pruneStalePositions();
  const positions = Array.from(openPositions.entries()).map(([pair, p]) => ({
    pair,
    ...p,
  }));
  const totalExposureUsd = positions.reduce((s, p) => s + p.sizeUsd, 0);
  const exposurePct = currentBalance > 0 ? (totalExposureUsd / currentBalance) * 100 : 0;
  const currentDrawdownPct =
    sessionPeakBalance > 0
      ? Math.max(0, ((sessionPeakBalance - currentBalance) / sessionPeakBalance) * 100)
      : 0;

  return {
    currentBalance: parseFloat(currentBalance.toFixed(2)),
    sessionPeakBalance: parseFloat(sessionPeakBalance.toFixed(2)),
    totalPnL: parseFloat(totalPnL.toFixed(2)),
    openPositions: positions,
    openCount: positions.length,
    totalExposureUsd: parseFloat(totalExposureUsd.toFixed(2)),
    exposurePct: parseFloat(exposurePct.toFixed(1)),
    maxExposurePct: MAX_PORTFOLIO_EXPOSURE_PCT,
    sessionDrawdownPct: parseFloat(currentDrawdownPct.toFixed(2)),
    maxSessionLossPct: MAX_SESSION_LOSS_PCT,
    minMarginThreshold: MIN_MARGIN_BALANCE_USD,
    marginHealthy: currentBalance >= MIN_MARGIN_BALANCE_USD,
    minWinRateGate: MIN_WIN_RATE_GATE,
    minConfidence: MIN_CONFIDENCE,
    maxPortfolioRisk: MAX_PORTFOLIO_RISK_SETTING,
  };
}

async function checkRiskGate(pair, consensus, marketData) {
  const checks = [];
  const vetoes = [];
  const state = getPortfolioState();
  const perf = getPerformanceStats(RISK_GATE_N);

  // 0. Margin Sentinel Hard Floor Check ($30)
  if (currentBalance < MIN_MARGIN_BALANCE_USD) {
    try {
      const { sendMarginAlert } = require('../notifications/telegramNotifier');
      sendMarginAlert(currentBalance, MIN_MARGIN_BALANCE_USD).catch(() => {});
    } catch (e) {}
    return fail(
      `🛑 CRITICAL MARGIN VETO: Trading balance ($${currentBalance.toFixed(2)}) is below $${MIN_MARGIN_BALANCE_USD.toFixed(2)} threshold — trading halted to protect capital`,
      0,
      1
    );
  }
  checks.push(`✓ Margin Sentinel Healthy ($${currentBalance.toFixed(2)} >= $${MIN_MARGIN_BALANCE_USD.toFixed(2)})`);

  // 1. Direction Check
  if (!consensus || consensus.signal === 'HOLD' || consensus.signal === 'neutral') {
    return fail('Signal is HOLD/Neutral — no trade needed', 0, 1);
  }
  checks.push('✓ Active Signal Direction');

  // 2. Hard Veto Flag Check
  if (consensus.veto_triggered) {
    return fail(`Hard Veto active: ${consensus.veto_reason}`, 0, 1);
  }
  checks.push('✓ No Veto Flags');

  // 3. Dynamic Regime-Based Confidence Check
  const regime = classifyRegime(marketData);
  let dynamicMinConf = MIN_CONFIDENCE; // default 0.72
  if (regime === REGIMES.CHOPPY_RANGING) {
    dynamicMinConf = parseFloat(process.env.RISK_CHOPPY_MIN_CONF || '0.80'); // selective in chop (80%), allowing high-conviction 82% multi-agent setups
  } else if (regime === REGIMES.STRONG_BULL_TREND) {
    if (consensus.signal === 'BUY') {
      dynamicMinConf = 0.65; // ride the bull trend
    } else {
      dynamicMinConf = 0.85; // counter-trend short in bull market requires exceptional conviction
    }
  } else if (regime === REGIMES.STRONG_BEAR_TREND) {
    if (consensus.signal === 'SELL') {
      dynamicMinConf = 0.65; // ride the bear trend down
    } else {
      dynamicMinConf = 0.85; // counter-trend long in bear market requires exceptional conviction
    }
  } else if (regime === REGIMES.HIGH_VOLATILITY_EXPANSION) {
    dynamicMinConf = 0.80; // be cautious of stop-hunts
  }

  // 2026-09-15 (Alan's instruction): 72% is an ABSOLUTE FLOOR, not a default.
  // The regime logic above could previously LOWER the bar to 0.65 for
  // with-trend entries, which silently undercut the stated 72% requirement in
  // exactly the conditions where the bot trades most. Regime may now only ever
  // RAISE the bar above MIN_CONFIDENCE, never drop below it.
  if (dynamicMinConf < MIN_CONFIDENCE) {
    dynamicMinConf = MIN_CONFIDENCE;
  }

  if (consensus.confidence < dynamicMinConf) {
    vetoes.push(
      `Confidence ${(consensus.confidence * 100).toFixed(1)}% < ${(dynamicMinConf * 100).toFixed(0)}% minimum (Regime: ${regime}, Direction: ${consensus.signal})`
    );
  } else {
    checks.push(`✓ Confidence (${(consensus.confidence * 100).toFixed(0)}% >= ${(dynamicMinConf * 100).toFixed(0)}% | Regime: ${regime} [${consensus.signal}])`);
  }

  // 4. MAJORITY Agent Agreement Check (tightened 2026-09-15)
  // Was: a flat floor of 2 agents, which on an 11-agent roster let trades
  // through on 18% support. Every trade in the ledger on 2026-09-15 executed
  // with agentsAgreeing === 0, so this check was either not reached or not
  // supplied a real count. Both are now fatal rather than silently permissive.
  const needed = requiredAgreement(consensus.totalAgents);
  const agreeing = Number(consensus.agentsAgreeing);
  if (!Number.isFinite(agreeing)) {
    vetoes.push('agentsAgreeing was not reported by the consensus engine — refusing to trade on an unknown vote count');
  } else if (agreeing < needed) {
    vetoes.push(
      `Only ${agreeing}/${consensus.totalAgents || '?'} agents agree — requires a MAJORITY (${needed})`
    );
  } else {
    checks.push(`✓ Majority Consensus (${agreeing}/${consensus.totalAgents} — needed ${needed})`);
  }

  // 5. Session Drawdown Check
  if (state.sessionDrawdownPct >= MAX_SESSION_LOSS_PCT) {
    vetoes.push(
      `Session drawdown (${state.sessionDrawdownPct}%) exceeded maximum allowable threshold (${MAX_SESSION_LOSS_PCT}%)`
    );
  } else {
    checks.push(`✓ Session Drawdown Healthy (${state.sessionDrawdownPct}%)`);
  }

  // 6. Portfolio Exposure Ceiling Check
  if (state.exposurePct >= MAX_PORTFOLIO_EXPOSURE_PCT) {
    vetoes.push(
      `Portfolio exposure (${state.exposurePct}%) at max capacity (${MAX_PORTFOLIO_EXPOSURE_PCT}%)`
    );
  } else {
    checks.push(`✓ Exposure Headroom (${(MAX_PORTFOLIO_EXPOSURE_PCT - state.exposurePct).toFixed(0)}% available)`);
  }

  // 7. 68% Win Rate Strategy Gate Check with Automated Deadlock Self-Healing
  let isDeadlockWaiver = false;
  if (perf.sampleSize >= RISK_GATE_N && perf.winRate < MIN_WIN_RATE_GATE) {
    const isNetProfitable = (perf.totalPnlUsd || 0) > 0;
    const isHighConviction = (consensus?.confidence || 0) >= 0.80;
    // 2026-09-15: was a flat `>= 3`, which on an 11-agent roster let this
    // waiver bypass the profitability gate on 27% support. The waiver now
    // demands the same MAJORITY as a normal trade, plus the 80% conviction.
    const isStrongAgreement = (consensus?.agentsAgreeing || 0) >= requiredAgreement(consensus?.totalAgents);

    if (isNetProfitable && perf.winRate >= 0.65) {
      checks.push(`✓ Adaptive Profitability Gate: Rolling win rate (${perf.winRatePct}) approved under Net-Profitable Self-Heal (+$${perf.totalPnlUsd} USD)`);
    } else if (isHighConviction && isStrongAgreement) {
      isDeadlockWaiver = true;
      checks.push(`✓ High-Conviction Deadlock Waiver: ${(consensus.confidence * 100).toFixed(0)}% confidence across ${consensus.agentsAgreeing} agents grants 0.75x sizing waiver`);
    } else {
      vetoes.push(
        `Rolling ${RISK_GATE_N}-trade win rate (${perf.winRatePct}) below ${(MIN_WIN_RATE_GATE * 100).toFixed(0)}% profitability gate`
      );
    }
  } else if (perf.sampleSize < RISK_GATE_N) {
    // Honest label: not enough real trades yet, so the gate is not assessed (paper sampling).
    checks.push(`• Profitability Gate not yet assessed: ${perf.sampleSize}/${RISK_GATE_N} real trades`);
  } else {
    checks.push(`✓ Profitability Gate (${perf.winRatePct} >= ${(MIN_WIN_RATE_GATE * 100).toFixed(0)}%)`);
  }

  // 8. Market Price & ATR Availability
  const price = marketData?.price?.price;
  if (!price || price <= 0) {
    return fail('Missing valid market price quote', 0, 1);
  }

  if (vetoes.length > 0) {
    logger.warn(`[${pair}] 🛑 Risk Gate Rejected: ${vetoes.join('; ')}`);
    return {
      approved: false,
      reason: vetoes.join('; '),
      checks,
      vetoes,
      rejectionReasons: vetoes,
      positionSizeUsd: 0,
      leverage: 1,
      portfolioState: state,
    };
  }

  // ── SIZING: Dynamic Portfolio Risk & Half-Kelly Criterion ───────────
  const dynamicRisk = calculateDynamicPortfolioRisk({
    confidence: consensus.confidence,
    winRate: perf.winRate,
    btcTrend: marketData?.btcBenchmark?.trend || 'NEUTRAL',
    rawSetting: MAX_PORTFOLIO_RISK_SETTING,
  });

  // Volatility-adjusted Stop Loss & Take Profit using ATR
  const rRatio = 2.2;
  const atr = marketData?.indicators?.atr14 || price * 0.02;
  const atrPct = (atr / price) * 100;
  const stopLossPct = Math.max(1.5, Math.min(4.0, parseFloat((atrPct * 1.2).toFixed(2))));
  const takeProfitPct = parseFloat((stopLossPct * rRatio).toFixed(2));

  // Dynamic portfolio risk capital allocation bounds
  const maxAllowedLossUsd = currentBalance * dynamicRisk.dynamicRiskDecimal;
  const riskBoundedPositionUsd = maxAllowedLossUsd / (stopLossPct / 100);

  // Kelly % = W - (1 - W) / R where W is win rate, R is reward:risk ratio (2.2)
  const winRateEst = Math.max(0.60, Math.min(0.90, perf.winRate));
  const rawKelly = winRateEst - (1 - winRateEst) / rRatio;
  const fractionalKelly = Math.max(0.02, Math.min(0.20, rawKelly * 0.25)); // Safe fractional Kelly

  // Sizing bounded by MAX_SINGLE_POSITION_PCT (10%) and minimum $10
  const waiverMultiplier = isDeadlockWaiver ? 0.75 : 1.0;
  
  // Cap position size strictly at 10%
  const strictMaxPositionPct = 10;
  const maxPositionUsd = (currentBalance * strictMaxPositionPct) / 100;
  
  const kellySizedUsd = currentBalance * fractionalKelly * (consensus.confidence / 0.8) * waiverMultiplier;
  const targetSizedUsd = Math.min(kellySizedUsd, maxPositionUsd * waiverMultiplier, riskBoundedPositionUsd);
  const positionSizeUsd = Math.max(10, Math.min(targetSizedUsd, maxPositionUsd * waiverMultiplier));

  // Dynamic leverage constraint based on consensus strength (scaled up to LEVERAGE_MAX, e.g. 20x)
  let leverage = 1.0;
  if (LEVERAGE_MAX > 1.0 && consensus.confidence >= 0.40) {
    const minStrength = 0.40;
    const maxStrength = 0.95;
    const strengthRatio = Math.max(0, Math.min(1, (consensus.confidence - minStrength) / (maxStrength - minStrength)));
    leverage = parseFloat((1.0 + strengthRatio * (LEVERAGE_MAX - 1.0)).toFixed(1));
  }

  logger.info(
    `[${pair}] ✅ Risk Gate Approved: $${positionSizeUsd.toFixed(2)} position | ${leverage}x leverage (Consensus: ${(consensus.confidence * 100).toFixed(1)}% | Dynamic Risk: ${dynamicRisk.dynamicRiskPct}%) | SL: -${stopLossPct}% | TP: +${takeProfitPct}%`
  );

  const approvedDecision = {
    approved: true,
    reason: checks.join(', '),
    checks,
    vetoes: [],
    positionSizeUsd: parseFloat(positionSizeUsd.toFixed(2)),
    leverage,
    stopLossPct,
    takeProfitPct,
    dynamicRiskPct: dynamicRisk.dynamicRiskPct,
    maxLossAllowedUsd: parseFloat(maxAllowedLossUsd.toFixed(2)),
    dynamicRiskFactors: dynamicRisk.factors,
    riskScore: 2.5,
    portfolioState: state,
  };

  // 2026-09-24: Allocation Manager sizes the trade WITHIN this approval (it can only
  // shrink or keep the size and leverage, never enlarge them or approve a rejection).
  // Fails closed: if it errors, the trade is not placed.
  try {
    const { allocate } = require('../agents/allocationAgent');
    const final = allocate({ pair, consensus, riskDecision: approvedDecision });
    if (final.approved) {
      logger.info(`[${pair}] 📐 Allocation Manager: $${approvedDecision.positionSizeUsd} -> $${final.positionSizeUsd} | ${final.leverage}x | ${final.allocation.reasons.join('; ')}`);
    } else {
      logger.warn(`[${pair}] 📐 Allocation Manager blocked: ${final.reason}`);
    }
    return final;
  } catch (err) {
    logger.error(`[${pair}] Allocation Manager error, trade not placed: ${err.message}`);
    return fail(`Allocation Manager error: ${err.message}`, 0, 1);
  }
}

function fail(reason, positionSizeUsd = 0, leverage = 1) {
  return {
    approved: false,
    reason,
    checks: [],
    vetoes: [reason],
    rejectionReasons: [reason],
    positionSizeUsd,
    leverage,
    portfolioState: getPortfolioState(),
  };
}

function updateBalance(newBalance, pnlDelta = 0, resetPeak = false) {
  currentBalance = Math.max(0, newBalance);
  totalPnL += pnlDelta;
  if (resetPeak || currentBalance > sessionPeakBalance) {
    sessionPeakBalance = currentBalance;
  }
  savePersistedState();
}

function recordOpenPosition(pair, position) {
  openPositions.set(pair, {
    ...position,
    timestamp: new Date().toISOString(),
  });
}

function removePosition(pair) {
  openPositions.delete(pair);
}

/**
 * Resolve an open paper position against a REAL current price.
 * Added 2026-09-03 to replace exchangeRouter.js's Math.random() coin-flip,
 * which previously decided every paper trade's WIN/LOSS by drawing against
 * its own confidence score instead of checking what price actually did.
 *
 * Call this once per cycle (per pair) with the latest fetched price. It
 * checks the open position's take-profit / stop-loss levels and its TTL
 * (POSITION_TTL_MS, 5 min), and if either is hit it records a REAL trade
 * outcome via tradeLedger.recordTrade and updates the account balance.
 * Positions that haven't hit TP/SL/TTL yet are left open and untouched.
 *
 * @param {string} pair
 * @param {number} currentPrice
 * @returns {object|null} the resolved trade record, or null if still open / no position
 */
function resolveOpenPosition(pair, currentPrice, btcPrice = null) {
  const pos = openPositions.get(pair);
  if (!pos || !currentPrice || currentPrice <= 0) return null;

  const entryPrice = pos.entryPrice;
  if (!entryPrice || entryPrice <= 0) return null;

  const isLong = String(pos.side).toUpperCase() !== 'SELL';
  const rawMovePct = isLong
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  const tpPct = pos.takeProfitPct ?? 4.0;
  const slPct = pos.stopLossPct ?? 2.0;
  const ageMs = pos.timestamp ? (Date.now() - new Date(pos.timestamp).getTime()) : POSITION_TTL_MS + 1;

  const hitTP = rawMovePct >= tpPct;
  const hitSL = rawMovePct <= -slPct;
  const timedOut = ageMs > POSITION_TTL_MS;

  if (!hitTP && !hitSL && !timedOut) {
    return null; // still open — nothing to resolve yet
  }

  const leverage = pos.leverage || 1;
  // Cap the realized move to whichever threshold was actually crossed, so a
  // late/slow price check doesn't credit more than the TP/SL level allowed.
  const cappedMovePct = hitTP ? tpPct : hitSL ? -slPct : rawMovePct;
  const grossPnlPct = cappedMovePct * leverage;
  const sizeUsd = pos.sizeUsd || 0;
  const grossPnlUsd = sizeUsd * (grossPnlPct / 100);

  // Fees and spread are charged on the NOTIONAL (size x leverage), not on the
  // margin. Leaving them out made every recorded result flatter than reality.
  const notionalUsd = sizeUsd * leverage;
  const costUsd = parseFloat((notionalUsd * (ROUND_TRIP_COST_PCT / 100)).toFixed(4));

  const pnlUsd = parseFloat((grossPnlUsd - costUsd).toFixed(2));
  const pnlPct = sizeUsd > 0 ? (pnlUsd / sizeUsd) * 100 : 0;
  const outcome = pnlUsd > 0.01 ? 'WIN' : pnlUsd < -0.01 ? 'LOSS' : 'BREAKEVEN';

  // Calculate Realized Alpha vs BTC
  let btcReturnPct = null;
  let alphaVsBtcPct = null;
  let outperformedBtc = null;
  const btcEntryPrice = pos.btcEntryPrice || null;
  const btcExitPrice = btcPrice || (pair === 'BTC/USDT' ? currentPrice : null);
  if (btcEntryPrice && btcExitPrice) {
    try {
      const { calculateAlphaVsBtc } = require('../data/btcBenchmark');
      const alphaRes = calculateAlphaVsBtc(btcEntryPrice, btcExitPrice, pnlPct);
      btcReturnPct = alphaRes.btcReturnPct;
      alphaVsBtcPct = alphaRes.alphaVsBtcPct;
      outperformedBtc = alphaRes.outperformedBtc;
    } catch (_) {}
  }

  const { recordTrade } = require('./tradeLedger');
  const tradeRecord = recordTrade({
    pair,
    symbol: pair.split('/')[0],
    side: pos.side,
    price: parseFloat(currentPrice.toFixed(6)),
    amount: pos.sizeUsd && entryPrice ? parseFloat((pos.sizeUsd / entryPrice).toFixed(6)) : undefined,
    positionSizeUsd: pos.sizeUsd || 0,
    leverage,
    pnlUsd,
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    outcome,
    confidence: pos.confidence || 0,
    regime: pos.regime || null,
    paper: true,
    reason: hitTP
      ? `Take-profit hit: +${cappedMovePct.toFixed(2)}% real price move`
      : hitSL
        ? `Stop-loss hit: ${cappedMovePct.toFixed(2)}% real price move`
        : `Position timed out after ${POSITION_TTL_MINUTES}min — closed at market (${rawMovePct.toFixed(2)}% real move)`,
    grossPnlUsd: parseFloat(grossPnlUsd.toFixed(2)),
    costUsd,
    costPct: ROUND_TRIP_COST_PCT,
    venue: 'PaperEngine-RealResolution',
    btcEntryPrice,
    btcExitPrice,
    btcReturnPct,
    alphaVsBtcPct,
    outperformedBtc,
  });

  updateBalance(currentBalance + pnlUsd, pnlUsd);
  removePosition(pair);

  // Hook into Continuous Self-Learning Engine
  try {
    const { StrategyLearner } = require('../learning/strategyLearner');
    const learner = new StrategyLearner();
    learner.recordOutcome({
      symbol: pair.split('/')[0],
      side: pos.side,
      entryPrice,
      exitPrice: currentPrice,
      sizeUsdt: pos.sizeUsd || 0,
      pnlUsdt: pnlUsd,
      pnlPct: pnlPct / 100,
      exchange: 'PaperEngine',
      agentVotes: pos.agentVotes || {},
      marketData: pos.marketDataSnapshot || {},
    }).catch((err) => {
      logger.warn(`StrategyLearner outcome error: ${err.message}`);
    });
  } catch (err) {
    logger.warn(`StrategyLearner instantiation notice: ${err.message}`);
  }

  logger.info(
    `[${pair}] 📈 Position RESOLVED (real price): ${outcome} ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd} (entry $${entryPrice.toFixed(4)} -> $${currentPrice.toFixed(4)}, ${rawMovePct.toFixed(2)}% move)${alphaVsBtcPct !== null ? ` | Alpha vs BTC: ${alphaVsBtcPct > 0 ? '+' : ''}${alphaVsBtcPct}%` : ''}`
  );

  return tradeRecord;
}

/**
 * Resolve ALL open positions that have crossed TP/SL/TTL, given a map of
 * current prices keyed by pair (e.g. { 'BTC/USDT': 68450.12, ... }).
 * Safe to call every cycle even if priceMap is missing entries for some
 * open pairs — those are simply left open until a price is available.
 */
function resolveAllOpenPositions(priceMap = {}) {
  const resolved = [];
  const btcPrice = priceMap['BTC/USDT'] || null;
  for (const pair of Array.from(openPositions.keys())) {
    const price = priceMap[pair];
    if (!price) continue;
    const result = resolveOpenPosition(pair, price, btcPrice);
    if (result) resolved.push(result);
  }
  return resolved;
}

function clearOpenPositions() {
  openPositions.clear();
}

function resetPortfolioState(newBalance = INITIAL_DEPOSIT) {
  currentBalance = newBalance;
  totalPnL = 0;
  sessionPeakBalance = newBalance;
  openPositions.clear();
  savePersistedState();
  return getPortfolioState();
}

module.exports = {
  checkRiskGate,
  passesRiskGate: checkRiskGate,
  getPortfolioState,
  resetPortfolioState,
  updateBalance,
  recordOpenPosition,
  removePosition,
  resolveOpenPosition,
  resolveAllOpenPositions,
  clearOpenPositions,
  savePersistedState,
  loadPersistedState,
  getAllocationSettings,
  updateAllocationSettings,
  calculateProportionateAllocation,
  calculateDynamicPortfolioRisk,
  CURRENCY_RATES,
  INITIAL_DEPOSIT,
};
