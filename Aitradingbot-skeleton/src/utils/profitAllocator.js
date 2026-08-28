/**
 * Profit Allocator & Vault Engine
 * On every profitable trade:
 *   40% -> Reinvested back into trading capital
 *   50% -> Converted into BTC savings pool
 *   10% -> Cold storage / long-term hold vault
 *
 * 2x Initial Deposit Trigger: Recommends profit sweep while compounding base.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getPortfolioState, updateBalance, INITIAL_DEPOSIT } = require('../risk/riskGate');

const DATA_DIR = path.resolve(__dirname, '../../data');
const VAULT_FILE = path.join(DATA_DIR, 'vault_summary.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const REINVEST_PCT = parseFloat(process.env.PROFIT_REINVEST_PCT || '0.40');
const BTC_PCT = parseFloat(process.env.PROFIT_BTC_PCT || '0.50');
const LONGTERM_PCT = parseFloat(process.env.PROFIT_LONGTERM_PCT || '0.10');
const DOUBLE_TRIGGER = parseFloat(process.env.PROFIT_DOUBLE_TRIGGER || '2.0');

let btcSavingsUsd = 0.0;
let longtermHoldUsd = 0.0;
let totalProfitsHarvested = 0.0;
let milestoneReached = false;

function loadPersistedVault() {
  try {
    ensureDataDir();
    if (fs.existsSync(VAULT_FILE)) {
      const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
      if (typeof data.btcSavingsUsd === 'number') btcSavingsUsd = data.btcSavingsUsd;
      if (typeof data.longtermHoldUsd === 'number') longtermHoldUsd = data.longtermHoldUsd;
      if (typeof data.totalProfitsHarvested === 'number') totalProfitsHarvested = data.totalProfitsHarvested;
      if (typeof data.milestoneReached === 'boolean') milestoneReached = data.milestoneReached;
    }
  } catch (e) {
    logger.warn(`Could not load persisted vault: ${e.message}`);
  }
}

function savePersistedVault() {
  try {
    ensureDataDir();
    const data = {
      btcSavingsUsd,
      longtermHoldUsd,
      totalProfitsHarvested,
      milestoneReached,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn(`Could not save vault state: ${e.message}`);
  }
}

loadPersistedVault();

async function allocateProfits(tradeResult) {
  const pnl = tradeResult?.pnlUsd || tradeResult?.pnl || 0;
  if (pnl <= 0) {
    // Loss or flat trade
    const { currentBalance } = getPortfolioState();
    updateBalance(currentBalance + pnl, pnl);
    return { allocated: false, pnl };
  }

  const reinvest = pnl * REINVEST_PCT;
  const toBTC = pnl * BTC_PCT;
  const toLongterm = pnl * LONGTERM_PCT;

  btcSavingsUsd += toBTC;
  longtermHoldUsd += toLongterm;
  totalProfitsHarvested += pnl;

  const { currentBalance } = getPortfolioState();
  const newTradingBalance = currentBalance + reinvest;
  updateBalance(newTradingBalance, pnl);

  logger.info(
    `💰 PROFIT ALLOCATION: +$${pnl.toFixed(2)} total profit -> ` +
      `+$${reinvest.toFixed(2)} (40% reinvested) | ` +
      `+$${toBTC.toFixed(2)} (50% -> BTC Savings) | ` +
      `+$${toLongterm.toFixed(2)} (10% -> Long-Term Vault)`
  );

  const doubleTarget = INITIAL_DEPOSIT * DOUBLE_TRIGGER;
  if (newTradingBalance + btcSavingsUsd + longtermHoldUsd >= doubleTarget && !milestoneReached) {
    milestoneReached = true;
    logger.info(
      `\n🎯 2X MILESTONE HIT! Total Portfolio Value $${(newTradingBalance + btcSavingsUsd + longtermHoldUsd).toFixed(2)} >= $${doubleTarget.toFixed(2)}`
    );
    logger.info(
      `   Recommendation: Withdraw BTC savings ($${btcSavingsUsd.toFixed(2)}) + Long-Term pool ($${longtermHoldUsd.toFixed(2)}) to hardware wallet`
    );
  }

  const result = {
    allocated: true,
    pnl,
    reinvest: parseFloat(reinvest.toFixed(2)),
    toBTC: parseFloat(toBTC.toFixed(2)),
    toLongterm: parseFloat(toLongterm.toFixed(2)),
    btcSavingsUsd: parseFloat(btcSavingsUsd.toFixed(2)),
    longtermHoldUsd: parseFloat(longtermHoldUsd.toFixed(2)),
    totalTradingBalance: parseFloat(newTradingBalance.toFixed(2)),
    milestoneReached,
  };
  savePersistedVault();
  return result;
}

function getVaultSummary() {
  const state = getPortfolioState();
  const totalNetWorth = state.currentBalance + btcSavingsUsd + longtermHoldUsd;

  return {
    tradingBalance: state.currentBalance,
    btcSavingsUsd: parseFloat(btcSavingsUsd.toFixed(2)),
    longtermHoldUsd: parseFloat(longtermHoldUsd.toFixed(2)),
    totalProfitsHarvested: parseFloat(totalProfitsHarvested.toFixed(2)),
    totalNetWorth: parseFloat(totalNetWorth.toFixed(2)),
    initialDeposit: INITIAL_DEPOSIT,
    totalRoiPct: parseFloat((((totalNetWorth - INITIAL_DEPOSIT) / INITIAL_DEPOSIT) * 100).toFixed(2)),
    milestoneReached,
    milestoneTarget: INITIAL_DEPOSIT * DOUBLE_TRIGGER,
  };
}

module.exports = {
  allocateProfits,
  getVaultSummary,
  savePersistedVault,
  loadPersistedVault,
};
