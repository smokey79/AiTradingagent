/**
 * Profit Allocator & Vault Engine (Daily Rolling Compounding)
 * Accumulates profits throughout the day.
 * At 12 AM:
 *   Phase 1 (Recovery): < (Initial + 50) -> 60% Taken to Main, 40% Reinvested
 *   Phase 2 (Growth):   >= (Initial + 50) -> 40% Taken to Main, 60% Reinvested
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getPortfolioState, updateBalance, INITIAL_DEPOSIT } = require('../risk/riskGate');
const cron = require('node-cron');

const DATA_DIR = path.resolve(__dirname, '../../data');
const VAULT_FILE = path.join(DATA_DIR, 'vault_summary.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let mainAccountUsdt = 0.0;
let btcSavingsUsd = 0.0;
let longtermHoldUsd = 0.0;
let unrealizedDailyPnl = 0.0;
let totalProfitsHarvested = 0.0;
let milestoneReached = false;
let lastSweepDate = null;

function loadPersistedVault() {
  try {
    ensureDataDir();
    if (fs.existsSync(VAULT_FILE)) {
      const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      if (typeof data.mainAccountUsdt === 'number') mainAccountUsdt = data.mainAccountUsdt;
      if (typeof data.btcSavingsUsd === 'number') btcSavingsUsd = data.btcSavingsUsd;
      if (typeof data.longtermHoldUsd === 'number') longtermHoldUsd = data.longtermHoldUsd;
      if (typeof data.unrealizedDailyPnl === 'number') unrealizedDailyPnl = data.unrealizedDailyPnl;
      if (typeof data.totalProfitsHarvested === 'number') totalProfitsHarvested = data.totalProfitsHarvested;
      if (typeof data.milestoneReached === 'boolean') milestoneReached = data.milestoneReached;
      if (data.lastSweepDate) lastSweepDate = data.lastSweepDate;
    }
  } catch (e) {
    logger.warn(`Could not load persisted vault: ${e.message}`);
  }
}

function savePersistedVault() {
  try {
    ensureDataDir();
    const data = {
      mainAccountUsdt,
      btcSavingsUsd,
      longtermHoldUsd,
      unrealizedDailyPnl,
      totalProfitsHarvested,
      milestoneReached,
      lastSweepDate,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn(`Could not save vault state: ${e.message}`);
  }
}

loadPersistedVault();

// Accumulate PnL dynamically on each trade
async function allocateProfits(tradeResult) {
  const pnl = tradeResult?.pnlUsd || tradeResult?.pnl || 0;
  
  // If flat or loss, we just update the balance immediately.
  const { currentBalance } = getPortfolioState();
  updateBalance(currentBalance + pnl, pnl);
  
  unrealizedDailyPnl += pnl;

  let reinvest = 0;
  let toBTC = 0;
  let toLongterm = 0;
  let allocated = false;

  if (pnl > 0) {
    allocated = true;
    reinvest = parseFloat((pnl * 0.40).toFixed(2));
    toBTC = parseFloat((pnl * 0.50).toFixed(2));
    toLongterm = parseFloat((pnl * 0.10).toFixed(2));
    btcSavingsUsd = parseFloat((btcSavingsUsd + toBTC).toFixed(2));
    longtermHoldUsd = parseFloat((longtermHoldUsd + toLongterm).toFixed(2));
    totalProfitsHarvested = parseFloat((totalProfitsHarvested + pnl).toFixed(2));
  }

  savePersistedVault();
  
  return {
    allocated,
    pnl,
    reinvest,
    toBTC,
    toLongterm,
    unrealizedDailyPnl,
  };
}

// Run the daily sweep
function processDailyCompounding() {
  logger.info(`[Compounding] Starting 12 AM Daily Sweep...`);
  if (unrealizedDailyPnl <= 0) {
    logger.info(`[Compounding] No positive PnL to sweep today. (Net: ${unrealizedDailyPnl.toFixed(2)})`);
    // Reset unrealized to 0 for the next day, losses are already baked into balance.
    unrealizedDailyPnl = 0;
    savePersistedVault();
    return;
  }

  const { currentBalance } = getPortfolioState();
  const threshold = INITIAL_DEPOSIT + 50.0;
  
  let takePct, reinvestPct;
  
  if (currentBalance < threshold) {
    // Phase 1: Recovery
    takePct = 0.60;
    reinvestPct = 0.40;
    logger.info(`[Compounding] Phase 1 (Recovery): Taking 60%, Reinvesting 40%`);
  } else {
    // Phase 2: Growth
    takePct = 0.40;
    reinvestPct = 0.60;
    milestoneReached = true;
    logger.info(`[Compounding] Phase 2 (Growth): Taking 40%, Reinvesting 60%`);
  }

  const takenAmt = unrealizedDailyPnl * takePct;
  const reinvestAmt = unrealizedDailyPnl * reinvestPct;

  mainAccountUsdt += takenAmt;
  totalProfitsHarvested += unrealizedDailyPnl;

  // The 'reinvestAmt' is technically already in the 'currentBalance' because allocateProfits() 
  // updates the balance instantly on every trade.
  // Wait, if allocateProfits already updated the balance by the FULL PnL, then we need to DEDUCT the 'takenAmt' from the bot's trading balance!
  const newTradingBalance = currentBalance - takenAmt;
  updateBalance(newTradingBalance, 0);

  logger.info(
    `💰 DAILY SWEEP COMPLETE: +$${unrealizedDailyPnl.toFixed(2)} total profit -> ` +
      `+$${reinvestAmt.toFixed(2)} (${(reinvestPct*100).toFixed(0)}% reinvested) | ` +
      `+$${takenAmt.toFixed(2)} (${(takePct*100).toFixed(0)}% -> Main Account)`
  );

  unrealizedDailyPnl = 0.0;
  lastSweepDate = new Date().toISOString();
  savePersistedVault();
}

// Schedule cron for 12:00 AM every day
cron.schedule('0 0 * * *', () => {
  processDailyCompounding();
});

function getVaultSummary() {
  const state = getPortfolioState();
  const totalNetWorth = state.currentBalance + mainAccountUsdt + btcSavingsUsd + longtermHoldUsd;

  return {
    tradingBalance: state.currentBalance,
    mainAccountUsdt: parseFloat(mainAccountUsdt.toFixed(2)),
    btcSavingsUsd: parseFloat(btcSavingsUsd.toFixed(2)),
    longtermHoldUsd: parseFloat(longtermHoldUsd.toFixed(2)),
    unrealizedDailyPnl: parseFloat(unrealizedDailyPnl.toFixed(2)),
    totalProfitsHarvested: parseFloat(totalProfitsHarvested.toFixed(2)),
    totalNetWorth: parseFloat(totalNetWorth.toFixed(2)),
    initialDeposit: INITIAL_DEPOSIT,
    totalRoiPct: parseFloat((((totalNetWorth - INITIAL_DEPOSIT) / INITIAL_DEPOSIT) * 100).toFixed(2)),
    milestoneReached,
    milestoneTarget: INITIAL_DEPOSIT + 50,
    lastSweepDate,
  };
}

function resetVaultState() {
  mainAccountUsdt = 0.0;
  btcSavingsUsd = 0.0;
  longtermHoldUsd = 0.0;
  unrealizedDailyPnl = 0.0;
  totalProfitsHarvested = 0.0;
  milestoneReached = false;
  lastSweepDate = null;
  savePersistedVault();
  return getVaultSummary();
}

module.exports = {
  allocateProfits,
  processDailyCompounding,
  getVaultSummary,
  resetVaultState,
  savePersistedVault,
  loadPersistedVault,
};
