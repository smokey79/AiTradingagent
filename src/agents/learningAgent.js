/**
 * Learning Agent — Continuous Trade Reviewer
 * =========================================================================================
 * Constantly reviews the trade ledger for losses. Extracts patterns and passes them
 * to the lossLearner memory bank so the bot never makes the exact same mistake twice.
 */

'use strict';

const logger = require('../utils/logger');
const { loadLedger } = require('../risk/tradeLedger');
const { recordLossPostMortem } = require('../learning/lossLearner');
const cron = require('node-cron');

let lastReviewTimestamp = Date.now() - (24 * 60 * 60 * 1000); // look back 24h by default

/**
 * Reviews the ledger for any new losses and learns from them.
 */
async function runBatchReview() {
  logger.info('🧠 [Learning Agent] Starting batch review of recent trades...');
  try {
    const ledger = loadLedger();
    const newLosses = ledger.filter(trade => {
      const tradeTime = new Date(trade.timestamp).getTime();
      return tradeTime > lastReviewTimestamp && (trade.outcome === 'LOSS' || trade.pnlUsd < 0);
    });

    if (newLosses.length === 0) {
      logger.info('🧠 [Learning Agent] No new losing trades found in this review window. Perfect execution.');
      lastReviewTimestamp = Date.now();
      return;
    }

    logger.info(`🧠 [Learning Agent] Analyzing ${newLosses.length} losing trade(s)...`);

    for (const loss of newLosses) {
      // In a more advanced implementation, we would pass this to an LLM to generate the exact context.
      // For now, we extract the context we know from the trade record.
      const marketContext = {
        price: loss.price,
        regimeAtExecution: loss.regime || 'UNKNOWN',
        reason: loss.reason,
      };

      const penalty = 0.15; // default 15% penalty for this exact setup in the future

      recordLossPostMortem(loss.symbol, loss.side || loss.signal, marketContext, penalty);
      logger.info(`📚 [Learning Agent] Learned from loss on ${loss.symbol} (${loss.side || loss.signal}). Mapped pattern to memory bank.`);
    }

    lastReviewTimestamp = Date.now();

    // If Telegram is enabled, we could alert the user here about the new lessons learned.
    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({
        type: 'learning_event',
        message: `Learning Agent reviewed ${newLosses.length} losses and updated the negative pattern memory bank.`,
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
