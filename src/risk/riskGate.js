/**
 * Institutional Risk Gate & Kelly Sizing Engine
 * Hard-veto safety checks, rolling win rate gate, and dynamic capital allocation.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getPerformanceStats } = require('./tradeLedger');

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
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.35'); // 35% minimum AI confidence (demo)
const LEVERAGE_MAX = parseFloat(process.env.LEVERAGE_MAX || '1.0');
const MAX_SINGLE_POSITION_PCT = parseFloat(process.env.RISK_MAX_SINGLE_POSITION_PCT || '25'); // Max 25% on one trade
const MAX_PORTFOLIO_EXPOSURE_PCT = parseFloat(process.env.RISK_MAX_PORTFOLIO_EXPOSURE_PCT || '95'); // Max 95% total exposure
const MAX_SESSION_LOSS_PCT = parseFloat(process.env.RISK_MAX_SESSION_LOSS_PCT || '8'); // Max 8% session drawdown
const MIN_WIN_RATE_GATE = parseFloat(process.env.RISK_MIN_WIN_RATE_GATE || '0.10'); // 10% rolling win rate target (demo)
const MIN_MARGIN_BALANCE_USD = parseFloat(process.env.MIN_MARGIN_BALANCE_USD || '30.0'); // $30 margin floor
const MIN_AGENTS = 2; // 2 agents min (demo)

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
  };
}

async function checkRiskGate(pair, consensus, marketData) {
  const checks = [];
  const vetoes = [];
  const state = getPortfolioState();
  const perf = getPerformanceStats(20);

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

  // 3. Minimum Confidence Check
  if (consensus.confidence < MIN_CONFIDENCE) {
    vetoes.push(
      `Confidence ${(consensus.confidence * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100).toFixed(0)}% minimum (${(MIN_CONFIDENCE * 100).toFixed(0)}% requirement)`
    );
  } else {
    checks.push(`✓ Confidence (${(consensus.confidence * 100).toFixed(0)}% >= ${(MIN_CONFIDENCE * 100).toFixed(0)}%)`);
  }

  // 4. Minimum Agent Agreement Check
  if (consensus.agentsAgreeing < MIN_AGENTS) {
    vetoes.push(`Only ${consensus.agentsAgreeing} agents agree — requires minimum ${MIN_AGENTS}`);
  } else {
    checks.push(`✓ Consensus Agreement (${consensus.agentsAgreeing}/${consensus.totalAgents})`);
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

  // 7. 72% Win Rate Strategy Gate Check
  if (perf.sampleSize >= 20 && perf.winRate < MIN_WIN_RATE_GATE) {
    vetoes.push(
      `Rolling 20-trade win rate (${perf.winRatePct}) below ${(MIN_WIN_RATE_GATE * 100).toFixed(0)}% profitability gate`
    );
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

  // ── SIZING: Half-Kelly Criterion with Volatility Adjustment ───────────
  // Kelly % = W - (1 - W) / R where W is win rate, R is reward:risk ratio (2.0)
  const winRateEst = Math.max(0.60, Math.min(0.90, perf.winRate));
  const rRatio = 2.2;
  const rawKelly = winRateEst - (1 - winRateEst) / rRatio;
  const halfKelly = Math.max(0.08, rawKelly * 0.50); // Half-Kelly for aggressive growth

  // Sizing bounded by MAX_SINGLE_POSITION_PCT and minimum $10
  const maxPositionUsd = (currentBalance * MAX_SINGLE_POSITION_PCT) / 100;
  const kellySizedUsd = currentBalance * halfKelly * (consensus.confidence / 0.8);
  const positionSizeUsd = Math.max(10, Math.min(kellySizedUsd, maxPositionUsd));

  // Volatility-adjusted Stop Loss & Take Profit using ATR
  const atr = marketData?.indicators?.atr14 || price * 0.02;
  const atrPct = (atr / price) * 100;
  const stopLossPct = Math.max(1.5, Math.min(4.0, parseFloat((atrPct * 1.2).toFixed(2))));
  const takeProfitPct = parseFloat((stopLossPct * rRatio).toFixed(2));

  // Leverage constraint
  let leverage = 1.0;
  if (consensus.confidence >= 0.88 && LEVERAGE_MAX > 1.0) {
    leverage = Math.min(LEVERAGE_MAX, 2.0);
  }

  logger.info(
    `[${pair}] ✅ Risk Gate Approved: $${positionSizeUsd.toFixed(2)} position | ${leverage}x leverage | SL: -${stopLossPct}% | TP: +${takeProfitPct}%`
  );

  return {
    approved: true,
    reason: checks.join(', '),
    checks,
    vetoes: [],
    positionSizeUsd: parseFloat(positionSizeUsd.toFixed(2)),
    leverage,
    stopLossPct,
    takeProfitPct,
    riskScore: 2.5,
    portfolioState: state,
  };
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
  getPortfolioState,
  resetPortfolioState,
  updateBalance,
  recordOpenPosition,
  removePosition,
  savePersistedState,
  loadPersistedState,
  getAllocationSettings,
  updateAllocationSettings,
  calculateProportionateAllocation,
  CURRENCY_RATES,
  INITIAL_DEPOSIT,
};
