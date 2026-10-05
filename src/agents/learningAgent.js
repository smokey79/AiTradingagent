/**
 * Learning Agent — Continuous Trade Reviewer
 * =========================================================================================
 * Constantly reviews the trade ledger for losses. Extracts patterns and passes them
 * to the lossLearner memory bank so the bot never makes the exact same mistake twice.
 *
 * 2026-09-26 fix (Claude): this file used to call recordLossPostMortem(a, b, c, d) with four
 * positional arguments, but lossLearner.recordLossPostMortem(...) takes ONE destructured
 * options object. Every call therefore destructured fields off a plain string (loss.symbol)
 * and silently fell back to defaults (symbol="CRYPTO", entryPrice/exitPrice=undefined,
 * pnlUsd=0), so every single reviewed loss was written to data/lost_trades_memory.json as
 * an identical generic "CRYPTO / LOW_VOLUME_FAKEOUT" record. Separately, lastReviewTimestamp
 * lived only in memory and reset to "24h ago" on every process restart, so each restart
 * re-reviewed (and re-duplicated) the same losses. Both are fixed below: the call now passes
 * a proper options object built from the real ledger record, and the review watermark is
 * persisted to disk so restarts don't reprocess the same window.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { readLearningTrades } = require('../learning/learningTrades');
const improvementLoop = require('../learning/improvementLoop');
const { recordLossPostMortem } = require('../learning/lossLearner');
// 2026-09-26: also record wins in the same batch pass (Tauric-Research-style
// win+loss memory - see src/learning/tradeLearner.js). This only adds a
// second, symmetric branch below; the loss branch and its dedupe/decay are
// untouched.
const { recordWinPostMortem } = require('../learning/tradeLearner');
const cron = require('node-cron');

const STATE_FILE = path.resolve(__dirname, '../../data/learning_agent_state.json');

function loadLastReviewTimestamp() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && Number.isFinite(raw.lastReviewTimestamp)) return raw.lastReviewTimestamp;
  } catch (e) {
    // no state file yet, or unreadable: fall through to the default below
  }
  return Date.now() - (24 * 60 * 60 * 1000); // first run ever: look back 24h
}

function saveLastReviewTimestamp(ts) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ lastReviewTimestamp: ts, reviewedTradeIds: [...reviewedTradeIds] }, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

let lastReviewTimestamp = loadLastReviewTimestamp();
let reviewedTradeIds = new Set();
try {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  reviewedTradeIds = new Set(state.reviewedTradeIds || []);
} catch (_) { /* first review */ }

/**
 * Reviews the ledger for any new losses and learns from them.
 */
async function runBatchReview() {
  logger.info('🧠 [Learning Agent] Starting batch review of recent trades...');
  try {
    // Identity checkpoints also catch old entries that close or arrive after a review.
    const ledger = readLearningTrades().filter(trade => !reviewedTradeIds.has(trade.id) &&
      Number.isFinite(trade.entryPrice) && trade.entryPrice > 0 &&
      Number.isFinite(trade.exitPrice) && trade.exitPrice > 0);
    improvementLoop.writeReport(improvementLoop.runCycle());
    const newLosses = ledger.filter(trade => trade.pnlUsd < 0);
    // Post-mortem memory also deduplicates outcomes reviewed at close time.
    const newWins = ledger.filter(trade => trade.pnlUsd > 0);

    if (newLosses.length === 0 && newWins.length === 0) {
      logger.info('🧠 [Learning Agent] No new closed trades found in this review window.');
      lastReviewTimestamp = Date.now();
      saveLastReviewTimestamp(lastReviewTimestamp);
      return;
    }

    logger.info(`🧠 [Learning Agent] Analyzing ${newLosses.length} losing trade(s) and ${newWins.length} winning trade(s)...`);

    for (const loss of newLosses) {
      // In a more advanced implementation, we would pass this to an LLM to generate the exact context.
      // For now, we extract the context we know from the trade record.
      const marketData = {
        price: { price: loss.price },
        indicators: loss.indicators || {},
      };
      const btcBenchmark = {
        change24h: loss.btcChange24h,
        trend: loss.regime || 'UNKNOWN',
      };

      recordLossPostMortem({
        symbol: loss.symbol,
        side: loss.side || loss.signal,
        entryPrice: loss.entryPrice,
        exitPrice: loss.exitPrice ?? loss.price,
        pnlUsd: loss.pnlUsd,
        pnlPct: loss.pnlPct,
        marketData,
        btcBenchmark,
        reason: loss.reason || `Reviewed by batch learning agent (${loss.outcome || 'LOSS'})`,
      });
      reviewedTradeIds.add(loss.id);
      logger.info(`📚 [Learning Agent] Learned from loss on ${loss.symbol} (${loss.side || loss.signal}). Mapped pattern to memory bank.`);
    }

    for (const win of newWins) {
      const marketData = {
        price: { price: win.price },
        indicators: win.indicators || {},
      };
      const btcBenchmark = {
        change24h: win.btcChange24h,
        trend: win.regime || 'UNKNOWN',
      };

      recordWinPostMortem({
        symbol: win.symbol,
        side: win.side || win.signal,
        entryPrice: win.entryPrice,
        exitPrice: win.exitPrice ?? win.price,
        pnlUsd: win.pnlUsd,
        pnlPct: win.pnlPct,
        marketData,
        btcBenchmark,
        reason: win.reason || `Reviewed by batch learning agent (${win.outcome || 'WIN'})`,
      });
      reviewedTradeIds.add(win.id);
      logger.info(`📚 [Learning Agent] Learned from win on ${win.symbol} (${win.side || win.signal}). Mapped pattern to memory bank.`);
    }

    lastReviewTimestamp = Date.now();
    saveLastReviewTimestamp(lastReviewTimestamp);

    // If Telegram is enabled, we could alert the user here about the new lessons learned.
    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({
        type: 'learning_event',
        message: `Learning Agent reviewed ${newLosses.length} losses and ${newWins.length} wins, updating the trade memory bank.`,
      });
    }

  } catch (error) {
    logger.error(`[Learning Agent] Error during batch review: ${error.message}`);
  }
}

/**
 * Starts the automated CRON job to review trades daily.
 */
function startContinuousLearning() {
  // Trigger initial review on boot
  runBatchReview().catch(err => logger.error(`[Learning Agent] Initial review error: ${err.message}`));

  // Run every 12 hours
  cron.schedule('0 */12 * * *', () => {
    runBatchReview();
  });
  logger.info('📅 [Learning Agent] Scheduled continuous batch review (every 12 hours).');
}

module.exports = {
  runBatchReview,
  startContinuousLearning
};
