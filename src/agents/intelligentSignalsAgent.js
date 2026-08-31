/**
 * Intelligent Signals Agent
 * Parses automated machine learning / feature engineering signals from the @intelligent_trading_signals channel.
 * Extracts: Symbol, Score [-1, +1], Frequency.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const TELEGRAM_INGEST_PATH = path.join(DATA_DIR, 'telegram_alpha.json');

function loadTelegramSignals() {
  try {
    if (fs.existsSync(TELEGRAM_INGEST_PATH)) {
      return JSON.parse(fs.readFileSync(TELEGRAM_INGEST_PATH, 'utf8'));
    }
  } catch (e) {
    logger.warn(`Intelligent Signals Agent: Could not read Telegram alpha JSON: ${e.message}`);
  }
  return [];
}

async function getSignal(symbol, marketData = null) {
  // Normalize symbol (e.g. BTC/USDT -> BTC)
  const coin = symbol.split('/')[0].toUpperCase();
  const signals = loadTelegramSignals();

  // Filter messages from the target channel that mention this symbol
  // Target sender: "intelligent_trading_signals" or similar
  const relevantMessages = signals.filter(msg => {
    const sender = (msg.sender || '').toLowerCase();
    const text = (msg.text || '').toLowerCase();
    const isTargetChannel = sender.includes('intelligent') || sender.includes('signal');
    const mentionsCoin = text.includes(coin.toLowerCase()) || text.includes(`${coin.toLowerCase()}usdt`);
    return isTargetChannel && mentionsCoin;
  });

  if (relevantMessages.length === 0) {
    return {
      signal: 'HOLD',
      confidence: 0.70,
      weight: 1.0,
      reason: `[ML Signal] No recent Telegram signals found for ${coin} from @intelligent_trading_signals`,
      rawResponse: null,
    };
  }

  // Get the latest signal (messages are unshifted/newest first)
  const latestMessage = relevantMessages[0];
  const messageTime = new Date(latestMessage.timestamp).getTime();
  const now = Date.now();
  
  // Enforce a 10-minute freshness window (frequency is 1m, so 10m is very safe)
  const isFresh = (now - messageTime) < (10 * 60 * 1000);

  if (!isFresh) {
    return {
      signal: 'HOLD',
      confidence: 0.70,
      weight: 1.0,
      reason: `[ML Signal] Telegram signal for ${coin} found but is stale (${Math.round((now - messageTime)/60000)}m old)`,
      rawResponse: latestMessage,
    };
  }

  // Parse the Score from the message
  // Expected formats: "Score: 0.45", "score = -0.26", "Score [-1, +1]: +0.8" etc.
  const text = latestMessage.text;
  const scoreRegex = /(?:score|val|value)\s*[:=]?\s*([+-]?\d*(?:\.\d+)?)/i;
  const match = text.match(scoreRegex);

  let score = 0;
  if (match && match[1]) {
    score = parseFloat(match[1]);
  } else {
    // Fallback: search for any signed float in the text if no "score" keyword is found
    const fallbackRegex = /([+-]\d*\.\d+)/;
    const fallbackMatch = text.match(fallbackRegex);
    if (fallbackMatch && fallbackMatch[1]) {
      score = parseFloat(fallbackMatch[1]);
    }
  }

  // Determine signal based on the [-1, +1] score
  const BUY_THRESHOLD = parseFloat(process.env.TELEGRAM_BUY_THRESHOLD || '0.15');
  const SELL_THRESHOLD = parseFloat(process.env.TELEGRAM_SELL_THRESHOLD || '-0.15');

  let signal = 'HOLD';
  let reason = '';
  if (score >= BUY_THRESHOLD) {
    signal = 'BUY';
    reason = `[ML Signal] Bullish ML signal from @intelligent_trading_signals | Score: ${score.toFixed(2)} (>= ${BUY_THRESHOLD})`;
  } else if (score <= SELL_THRESHOLD) {
    signal = 'SELL';
    reason = `[ML Signal] Bearish ML signal from @intelligent_trading_signals | Score: ${score.toFixed(2)} (<= ${SELL_THRESHOLD})`;
  } else {
    signal = 'HOLD';
    reason = `[ML Signal] Neutral ML signal from @intelligent_trading_signals | Score: ${score.toFixed(2)} (between ${SELL_THRESHOLD} and ${BUY_THRESHOLD})`;
  }

  // Confidence is absolute value of score (capped between 0.5 and 0.95 for sanity)
  const confidence = Math.max(0.5, Math.min(0.95, Math.abs(score)));

  return {
    signal,
    confidence,
    weight: 1.2, // Credibility weight for ML feature engineered feeds
    reason,
    rawResponse: {
      messageId: latestMessage.id,
      timestamp: latestMessage.timestamp,
      parsedScore: score,
      originalText: text,
    }
  };
}

module.exports = { getSignal };
